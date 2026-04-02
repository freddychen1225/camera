const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start');
const capture1Btn = document.getElementById('capture1');
const status = document.getElementById('status');

let stream = null;

startBtn.onclick = async () => {
  try {
    status.textContent = '請求後置相機權限...';
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
    status.textContent = '後置相機就緒，請拍攝背景場景';
    
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.style.display = 'block';
      video.play();
      status.textContent = `解析度: ${video.videoWidth}x${video.videoHeight} | 拍背景`;
      drawLoop();
    };
  } catch (err) {
    status.textContent = `相機失敗: ${err.name} - ${err.message}`;
    console.error('Media error:', err);
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
  localStorage.setItem('bgImage', bgDataUrl);
  console.log('✅ 階段1完成! 背景DataURL長度:', bgDataUrl.length);
  status.textContent = '✅ 背景已存localStorage (階段1完)! 準備階段2 MediaPipe';
  capture1Btn.textContent = '階段1完成';
  capture1Btn.disabled = true;
};

// 清理stream
window.onbeforeunload = () => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
};