const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start');
const capture1Btn = document.getElementById('capture1');
const status = document.getElementById('status');

let stream = null;

startBtn.onclick = async () => {
  try {
    status.textContent = '請求相機權限...';
    stream = await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = stream;
    startBtn.textContent = '相機運行中';
    startBtn.disabled = true;
    capture1Btn.disabled = false;
    status.textContent = '相機就緒，拍背景';
    
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.style.display = 'block';
      video.play();
      drawLoop();
    };
  } catch (err) {
    status.textContent = '相機失敗: ' + err.message;
    console.error(err);
  }
};

function drawLoop() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(drawLoop);
}

capture1Btn.onclick = () => {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const bgDataUrl = canvas.toDataURL('image/png');
  console.log('背景畫面已擷取! DataURL長度:', bgDataUrl.length);
  localStorage.setItem('bgImage', bgDataUrl);
  status.textContent = '背景已存 localStorage! 準備階段2';
  capture1Btn.textContent = '已完成階段1';
  capture1Btn.disabled = true;
};

// 頁面關閉時停stream
window.onbeforeunload = () => {
  if (stream) stream.getTracks().forEach(track => track.stop());
};