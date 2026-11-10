import CryptoKit
import Foundation
import Security
import SwiftUI

/// 드롭박스 앱 폴더에 catalog.json 한 파일만 둔다. 사진은 올리지 않는다.
///
/// 로그인은 PKCE 코드 방식이고 리다이렉트를 쓰지 않는다 — 드롭박스 문서가 리다이렉트 주소를
/// https(또는 localhost)만 받는다고 해서, 승인 화면에 뜨는 코드를 앱에 붙여넣는 길로 갔다.
/// 한 번 연결하면 리프레시 토큰으로 계속 간다.
@MainActor
final class DropboxSync: ObservableObject {
    enum Phase: Equatable {
        case idle
        case syncing
        case failed(String)
    }

    @Published private(set) var linked = false
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var lastSync: Date?

    let appKey = (Bundle.main.object(forInfoDictionaryKey: "DropboxAppKey") as? String ?? "")
        .trimmingCharacters(in: .whitespaces)

    private let store: CatalogStore
    private let path = "/catalog.json"
    private var access: (token: String, expires: Date)?
    private var rev: String? {
        get { UserDefaults.standard.string(forKey: "fff.dropbox.rev") }
        set { UserDefaults.standard.set(newValue, forKey: "fff.dropbox.rev") }
    }

    init(store: CatalogStore) {
        self.store = store
        linked = Keychain.get("refresh") != nil
    }

    // MARK: 연결

    /// 승인 화면 주소. 여기서 만든 검증 값은 코드를 바꿀 때 다시 쓴다.
    func authorizeURL() -> URL {
        var bytes = [UInt8](repeating: 0, count: 48)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let verifier = Data(bytes).base64URL
        UserDefaults.standard.set(verifier, forKey: "fff.dropbox.verifier")
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var c = URLComponents(string: "https://www.dropbox.com/oauth2/authorize")!
        c.queryItems = [
            URLQueryItem(name: "client_id", value: appKey),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "token_access_type", value: "offline"),
        ]
        return c.url!
    }

    func finish(code: String) async throws {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty, let verifier = UserDefaults.standard.string(forKey: "fff.dropbox.verifier") else {
            throw DropboxError.message("코드가 비어 있어요")
        }
        let json = try await token([
            "code": code, "grant_type": "authorization_code", "code_verifier": verifier, "client_id": appKey,
        ])
        guard let refresh = json["refresh_token"] as? String else { throw DropboxError.message("리프레시 토큰을 받지 못했어요") }
        Keychain.set("refresh", refresh)
        remember(json)
        UserDefaults.standard.removeObject(forKey: "fff.dropbox.verifier")
        linked = true
        await sync()
    }

    func unlink() {
        Keychain.set("refresh", nil)
        access = nil
        rev = nil
        linked = false
        phase = .idle
    }

    // MARK: 동기화

    /// 받아서 합치고, 달라진 게 있으면 올린다. 기기가 하나여도 재설치 뒤 복구가 이 길로 된다.
    func sync() async {
        guard linked, phase != .syncing else { return }
        phase = .syncing
        do {
            let token = try await accessToken()
            let remote = try await download(token)
            if let remote { rev = remote.rev } else { rev = nil }
            let merged = remote.map { Catalog.merge(store.catalog, $0.catalog) } ?? store.catalog
            store.replace(with: merged)
            if remote == nil || merged != remote?.catalog {
                rev = try await upload(merged, token)
            }
            // 올리는 사이에 고친 게 있으면 다음 동기화에서 다시 올라가게 둔다
            if store.catalog == merged { store.markSynced() }
            lastSync = Date()
            phase = .idle
        } catch {
            phase = .failed((error as? DropboxError)?.text ?? error.localizedDescription)
        }
    }

    private func accessToken() async throws -> String {
        if let access, access.expires > Date().addingTimeInterval(60) { return access.token }
        guard let refresh = Keychain.get("refresh") else { throw DropboxError.message("연결이 풀렸어요") }
        let json = try await token(["grant_type": "refresh_token", "refresh_token": refresh, "client_id": appKey])
        remember(json)
        guard let access else { throw DropboxError.message("토큰을 받지 못했어요") }
        return access.token
    }

    private func remember(_ json: [String: Any]) {
        guard let t = json["access_token"] as? String else { return }
        let ttl = (json["expires_in"] as? Double) ?? 14400
        access = (t, Date().addingTimeInterval(ttl))
    }

    private func token(_ form: [String: String]) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: "https://api.dropboxapi.com/oauth2/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        req.httpBody = form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }
            .joined(separator: "&").data(using: .utf8)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else {
            let why = (json["error_description"] as? String) ?? (json["error"] as? String) ?? "응답 오류"
            // 리프레시 토큰이 죽었으면 다시 연결해야 한다
            if (json["error"] as? String) == "invalid_grant", form["grant_type"] == "refresh_token" { unlink() }
            throw DropboxError.message(why)
        }
        return json
    }

    private func download(_ token: String) async throws -> (catalog: Catalog, rev: String?)? {
        var req = URLRequest(url: URL(string: "https://content.dropboxapi.com/2/files/download")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("{\"path\":\"\(path)\"}", forHTTPHeaderField: "Dropbox-API-Arg")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let http = resp as? HTTPURLResponse
        if http?.statusCode == 409 {
            // 아직 파일이 없는 첫 동기화
            if String(data: data, encoding: .utf8)?.contains("not_found") == true { return nil }
        }
        guard http?.statusCode == 200 else { throw DropboxError.http(http?.statusCode ?? 0, data) }
        var rev: String?
        if let meta = http?.value(forHTTPHeaderField: "Dropbox-API-Result")?.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: meta) as? [String: Any] {
            rev = json["rev"] as? String
        }
        do {
            return (try Catalog.decode(data), rev)
        } catch {
            // 못 읽는 파일을 덮어쓰지 않는다
            throw DropboxError.message("드롭박스의 기록 파일을 읽지 못했어요")
        }
    }

    private func upload(_ catalog: Catalog, _ token: String) async throws -> String? {
        var req = URLRequest(url: URL(string: "https://content.dropboxapi.com/2/files/upload")!)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        // 받은 판(rev) 위에만 덮어쓴다. 그 사이 다른 곳에서 바뀌었으면 409 가 오고, 다음 동기화가 다시 합친다.
        // 판을 모르면(파일이 없거나 응답에 판이 없을 때) 그냥 쓴다 — 바로 앞에서 받아 합친 내용이다.
        let mode = rev.map { "{\".tag\":\"update\",\"update\":\"\($0)\"}" } ?? "\"overwrite\""
        req.setValue("{\"path\":\"\(path)\",\"mode\":\(mode),\"autorename\":false,\"mute\":true}", forHTTPHeaderField: "Dropbox-API-Arg")
        let (data, resp) = try await URLSession.shared.upload(for: req, from: try Catalog.encode(catalog))
        let http = resp as? HTTPURLResponse
        guard http?.statusCode == 200 else { throw DropboxError.http(http?.statusCode ?? 0, data) }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        return json?["rev"] as? String
    }
}

enum DropboxError: Error {
    case message(String)
    case http(Int, Data)

    var text: String {
        switch self {
        case .message(let m): return m
        case .http(let code, let data):
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            return (body?["error_summary"] as? String) ?? "드롭박스 오류 \(code)"
        }
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// 리프레시 토큰은 키체인에만 둔다
enum Keychain {
    private static let service = "com.kouga.fursuitfryday.dropbox"

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ key: String, _ value: String?) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(base as CFDictionary)
        guard let value else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }
}
