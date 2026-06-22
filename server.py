from flask import Flask, jsonify
import subprocess

app = Flask(__name__)

# 실행할 파이썬 파일 경로
TARGET_SCRIPT = r"C:\Users\SMART\Desktop\prn_api2"
PYTHON_EXE = "python"  # 가상환경 쓰면 해당 python.exe 경로로 변경

@app.route("/trigger", methods=["GET", "POST"])
def trigger():
    try:
        subprocess.Popen([PYTHON_EXE, TARGET_SCRIPT])
        return jsonify({"status": "started"}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3888)
