const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start');
const capture1Btn = document.getElementById('capture1');
const status = document.getElementById('status');

let stream = null;
let drawing = false;

function setStatus(msg) {
  status.textContent = msg;
  console.log(msg);
}

startBtn.onclick = async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('此瀏覽器不支援相機');
      return;
    }

    setStatus('請求相機權限中...');

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    video.setAttribute('autoplay', '');
    video.muted = true;
    video.style.display = 'block';
    canvas.style.display = 'block';

    video.onloadedmetadata = async () => {
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;

      try {
        await video.play();
      } catch (e) {
        console.error(e);
      }

      startBtn.textContent = '相機運行中';
      startBtn.disabled = true;
      capture1Btn.disabled = false;

      setStatus(`相機就緒 ${canvas.width} x ${canvas.height}`);
      if (!drawing) {
        drawing = true;
        drawLoop();
      }
    };

  } catch (err) {
    console.error(err);
    setStatus(`相機失敗：${err.name} / ${err.message}`);
    alert(`相機失敗：${err.name}\n${err.message}`);
  }
};

function drawLoop() {
  if (video.readyState >= 2 && canvas.width > 0 && canvas.height > 0) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(drawLoop);
}

capture1Btn.onclick = () => {
  if (!canvas.width || !canvas.height) {
    setStatus('尚未取得相機畫面');
    return;
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const bgDataUrl = canvas.toDataURL('image/png');
  localStorage.setItem('bgImage', bgDataUrl);

  console.log('背景已存，長度：', bgDataUrl.length);
  setStatus('✅ 背景已存 localStorage');
  capture1Btn.textContent = '階段1完成';
  capture1Btn.disabled = true;
};

window.addEventListener('beforeunload', () => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
});