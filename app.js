console.log('PoseGuide app.js v5 - 加入 MediaPipe AI');

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start');
const capture1Btn = document.getElementById('capture1');
const status = document.getElementById('status');

let stream = null;
let targetLandmarks = null;
let isCapturing = false;

function setStatus(msg) {
  status.textContent = msg;
}

// ====== 初始化 MediaPipe Pose ======
const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 0, // 0 最快，適合手機
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose.onResults(onPoseResults);

function onPoseResults(results) {
  // 把相機畫面畫到底層
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  // 如果偵測到人體，畫出骨架虛擬線
  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 4});
    drawLandmarks(ctx, results.poseLandmarks, {color: '#FF0000', lineWidth: 2, radius: 2});
    
    // 如果按下「鎖定完美姿勢」按鈕，就把這組骨架存起來
    if (isCapturing) {
      targetLandmarks = JSON.parse(JSON.stringify(results.poseLandmarks));
      localStorage.setItem('targetPose', JSON.stringify(targetLandmarks));
      setStatus('✅ 姿勢已鎖定！準備進入引導模式');
      capture1Btn.textContent = '已鎖定姿勢';
      capture1Btn.disabled = true;
      isCapturing = false;
    }
  } else if (isCapturing) {
    setStatus('❌ 畫面中找不到人，請重試');
    isCapturing = false;
  }
  ctx.restore();
}

// ====== 相機啟動與繪圖迴圈 ======
startBtn.onclick = async () => {
  setStatus('載入 AI 模組與相機中...');
  startBtn.disabled = true;
  
  try {
    const idealConstraints = { video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false };
    const fallbackConstraints = { video: true, audio: false };

    try {
      stream = await navigator.mediaDevices.getUserMedia(idealConstraints);
    } catch (e) {
      stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
    }
    
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.srcObject = stream;
    
    video.style.display = 'block';
    canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      
      video.play().then(() => {
        capture1Btn.disabled = false;
        setStatus('✅ AI 啟動完成，請將鏡頭對準人物');
        startBtn.style.display = 'none';
        
        // 開始將影片幀送給 AI 分析
        async function detectFrame() {
          if (video.readyState >= 2) {
            await pose.send({image: video});
          }
          requestAnimationFrame(detectFrame);
        }
        detectFrame();
        
      }).catch(e => setStatus('❌ 播放被阻擋，請輕觸畫面'));
    };

  } catch (err) {
    setStatus(`❌ 相機啟動失敗`);
    startBtn.disabled = false;
  }
};

capture1Btn.onclick = () => {
  setStatus('正在分析並鎖定姿勢...');
  isCapturing = true; // 觸發 onPoseResults 儲存骨架
};

window.addEventListener('beforeunload', () => {
  if (stream) stream.getTracks().forEach(t => t.stop());
});