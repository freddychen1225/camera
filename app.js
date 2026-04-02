console.log('PoseGuide app.js v4 載入！(強化 iOS PWA 相容性)');

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
  console.log('狀態:', msg);
}

startBtn.onclick = async () => {
  setStatus('檢查相機支援...');
  startBtn.disabled = true; // 防連點
  
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('此環境不支援 getUserMedia');
    }

    setStatus('請求相機權限...');
    
    // 降低解析度要求，明確拒絕音訊 (iOS PWA 關鍵)
    const idealConstraints = {
      video: {
        facingMode: 'environment',
        width: { ideal: 640 }, // 改用 640x480 提高成功率
        height: { ideal: 480 }
      },
      audio: false
    };

    const fallbackConstraints = { video: true, audio: false };

    try {
      console.log('嘗試後置鏡頭...');
      stream = await navigator.mediaDevices.getUserMedia(idealConstraints);
    } catch (e) {
      console.log('後置失敗，嘗試任意鏡頭...');
      stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }
    
    // 再次強制設定 iOS 播放屬性
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    
    video.style.display = 'block';
    canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          capture1Btn.disabled = false;
          setStatus(`✅ 相機就緒 (${canvas.width}x${canvas.height})`);
          startBtn.style.display = 'none'; // 啟動成功後隱藏啟動按鈕
          
          if (!drawing) {
            drawing = true;
            drawLoop();
          }
        }).catch(e => {
          console.error('播放被阻擋：', e);
          setStatus('❌ 播放被阻擋，請輕觸畫面重試');
          startBtn.disabled = false; // 讓使用者可以重試
          
          // 加入點擊畫面重試機制
          document.body.addEventListener('click', function retry() {
             video.play();
             document.body.removeEventListener('click', retry);
          }, { once: true });
        });
      }
    };

  } catch (err) {
    console.error('相機錯誤：', err);
    setStatus(`❌ 錯誤: ${err.name}`);
    startBtn.disabled = false;
    alert(`相機啟動失敗：${err.message}\n\n請確認：\n1. 已在 iOS 設定中允許 Safari/相機權限`);
  }
};

function drawLoop() {
  if (video.readyState >= 2 && canvas.width > 0 && canvas.height > 0) {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(drawLoop);
}

capture1Btn.onclick = () => {
  if (!canvas.width || !canvas.height) return;
  
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  localStorage.setItem('bgImage', dataUrl);
  
  setStatus(`✅ 階段1完成！背景已存`);
  capture1Btn.textContent = '已拍攝背景';
  capture1Btn.disabled = true;
};

window.addEventListener('beforeunload', () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
});