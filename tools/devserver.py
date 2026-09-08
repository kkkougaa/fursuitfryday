"""개발용 정적 서버.

  python tools/devserver.py          # 5173
  python tools/devserver.py 5173

0.0.0.0 에 묶는다 — 127.0.0.1 로만 묶으면 같은 와이파이의 아이폰에서 접속이
안 된다. 시작할 때 폰에서 열 주소를 함께 찍어 준다.

OAuth 리디렉션 URI 는 포트까지 정확히 일치해야 하므로 실제 로그인 테스트는
5173 으로 띄운다. (승인된 리디렉션 URI: http://localhost:5173/)
"""
import os
import sys
import socket
import functools
import http.server
import socketserver
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("PORT") or (sys.argv[1] if len(sys.argv) > 1 else 5173))


def lan_ip():
    """이 PC 의 LAN 주소. 인터넷에 실제로 붙지 않고 라우팅 테이블만 본다."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 고치고 새로고침하면 바로 반영되도록
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *a):
        sys.stderr.write("%s\n" % (fmt % a))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), functools.partial(H, directory=str(ROOT))) as s:
        ip = lan_ip()
        print(f"#FursuitFryday dev server  →  http://localhost:{PORT}/", flush=True)
        print(f"                      http://localhost:{PORT}/?demo=1   (데모)", flush=True)
        if ip:
            print(f"  같은 와이파이 폰  →  http://{ip}:{PORT}/", flush=True)
            print(f"                      http://{ip}:{PORT}/?demo=1   (데모)", flush=True)
        print("  Ctrl+C 로 종료", flush=True)
        try:
            s.serve_forever()
        except KeyboardInterrupt:
            print("\n종료", flush=True)
