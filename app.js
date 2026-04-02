console.log('PoseGuide app.js v3 載入！(修正相機 NotFound)');

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

// 初始化按鈕狀態
startBtn.textContent = '啟動相機';
startBtn.onclick = async () => {
  console.log('啟動相機按鈕點擊');
  try {
    setStatus('檢查瀏覽器支援...');
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('此瀏覽器不支援 getUserMedia 相機 API');
    }

    setStatus('請求相機權限中...');
    
    // 優先請求：後置鏡頭、高解析度
    const idealConstraints = {
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    };

    // 退一步請求：不挑鏡頭、不挑解析度 (PC 通常會走這條)
    const fallbackConstraints = {
      video: true
    };

    try {
      console.log('嘗試請求後置高解析度相機...');
      stream = await navigator.mediaDevices.getUserMedia(idealConstraints);
    } catch (e) {
      console.log('後置相機失敗，嘗試抓取任何可用相機...');
      stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }

    console.log('stream 取得成功，track 數：', stream.getVideoTracks().length);
    
    video.srcObject = stream;
    video.setAttribute('playsinline', ''); // iOS 必須
    video.muted = true;
    
    // 將 video 和 canvas 顯示出來
    video.style.display = 'block';
    canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      console.log('video metadata 就緒：', video.videoWidth, 'x', video.videoHeight);
      
      // 確保 canvas 尺寸與影片相符
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      
      video.play().then(() => {
        startBtn.disabled = true;
        capture1Btn.disabled = false;
        setStatus(`✅ 相機就緒 (${canvas.width}x${canvas.height})`);
        
        if (!drawing) {
          drawing = true;
          drawLoop();
        }
      }).catch(e => {
        console.error('video.play() 失敗：', e);
        setStatus('❌ 播放失敗：' + e.message);
      });
    };

  } catch (err) {
    console.error('getUserMedia 最終錯誤：', err);
    setStatus('❌ 相機錯誤：' + err.name + ' - ' + err.message);
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

  // 將當前畫面畫到 canvas 上
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  // 轉成 Base64 字串存入 localStorage
  const dataUrl = canvas.toDataURL('image/png');
  localStorage.setItem('bgImage', dataUrl);
  
  console.log('背景截圖已存，長度：', dataUrl.length);
  setStatus('✅ 階段 1 完成！背景已存');
  
  capture1Btn.textContent = '階段 1 完成';
  capture1Btn.disabled = true;
};

// 頁面關閉時停止相機
window.addEventListener('beforeunload', () => {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
});