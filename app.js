console.log('PoseGuide app.js v2 載入！');

// DOM元素
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

// 按鈕初始化
startBtn.textContent = 'app.js OK ✓ 點啟相機';
startBtn.onclick = async () => {
  console.log('啟動相機按鈕點擊');
  try {
    setStatus('檢查瀏覽器支援...');
    
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('瀏覽器不支援getUserMedia');
    }

    setStatus('請求後置相機...');
    
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',  // 後置
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    console.log('stream取得成功，track數：', stream.getVideoTracks().length);
    
    video.srcObject = stream;
    video.playsInline = true;  // iOS關鍵
    video.muted = true;
    
    video.onloadedmetadata = () => {
      console.log('video metadata：', video.videoWidth, 'x', video.videoHeight);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      video.play().then(() => {
        startBtn.disabled = true;
        capture1Btn.disabled = false;
        setStatus(`相機就緒 ${video.videoWidth}x${video.videoHeight}`);
        if (!drawing) drawLoop();
      }).catch(e => {
        console.error('video.play()失敗：', e);
        setStatus('播放失敗：' + e.message);
      });
    };

  } catch (err) {
    console.error('getUserMedia錯誤：', err);
    setStatus('❌ 相機錯誤：' + err.name + ' - ' + err.message);
  }
};

function drawLoop() {
  drawing = true;
  if (video.readyState >= 2) {
    ctx.drawImage(video, 0, 0);
  }
  requestAnimationFrame(drawLoop);
}

capture1Btn.onclick = () => {
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL();
  localStorage.setItem('background', dataUrl);
  console.log('背景截圖存好，長度：', dataUrl.length);
  setStatus('✅ 階段1完成！背景已存');
};