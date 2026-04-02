console.log('PoseGuide app.js v7 - 預覽下載與橫式支援');

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start');
const capture1Btn = document.getElementById('capture1');
const guideBtn = document.getElementById('guideBtn');
const status = document.getElementById('status');
const matchScoreDiv = document.getElementById('match-score');
const flash = document.getElementById('flash');

// 預覽視窗元素
const previewModal = document.getElementById('preview-modal');
const previewImg = document.getElementById('preview-img');
const saveBtn = document.getElementById('saveBtn');
const retryBtn = document.getElementById('retryBtn');

let stream = null;
let targetLandmarks = null;
let isCapturing = false;
let mode = 'scan'; 
let lastPhotoDataUrl = null;
let isPreviewing = false; // 記錄是否在預覽模式，暫停比對

function setStatus(msg) { status.textContent = msg; }

// ====== 處理螢幕旋轉與解析度 ======
function resizeCanvas() {
  if (video.videoWidth > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}
window.addEventListener('resize', resizeCanvas); // 支援手機打橫

function calculateMatchScore(current, target) {
  let totalDist = 0;
  for(let i=0; i<33; i++) {
    let dx = current[i].x - target[i].x;
    let dy = current[i].y - target[i].y;
    totalDist += Math.sqrt(dx*dx + dy*dy);
  }
  let avgDist = totalDist / 33;
  return Math.max(0, 100 - (avgDist * 300));
}

// ====== 拍照與預覽功能 ======
function takePhoto() {
  if (isPreviewing) return; // 避免連續觸發
  isPreviewing = true;
  
  // 畫面閃白
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  // 擷取原始相機畫面 (不含虛擬線)
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  tempCanvas.getContext('2d').drawImage(video, 0, 0);
  
  // 轉成高畫質 JPEG
  lastPhotoDataUrl = tempCanvas.toDataURL('image/jpeg', 1.0);
  
  // 顯示預覽視窗
  previewImg.src = lastPhotoDataUrl;
  previewModal.style.display = 'flex';
  setStatus('📸 拍照成功！請確認照片');
}

// 儲存照片按鈕
saveBtn.onclick = () => {
  // 利用 a 標籤的 download 屬性觸發瀏覽器下載
  const link = document.createElement('a');
  link.download = `PoseGuide_${new Date().getTime()}.jpg`;
  link.href = lastPhotoDataUrl;
  link.click(); // 觸發下載/儲存至相簿
  
  closePreview();
  setStatus('✅ 照片已儲存！繼續引導模式');
};

// 重拍按鈕
retryBtn.onclick = () => {
  closePreview();
  setStatus('繼續引導中...');
};

function closePreview() {
  previewModal.style.display = 'none';
  // 延遲 1 秒後才允許再次觸發拍照，避免一關掉馬上又拍
  setTimeout(() => { isPreviewing = false; }, 1000); 
}

// ====== MediaPipe Pose ======
const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
pose.setOptions({ modelComplexity: 0, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
pose.onResults(onPoseResults);

function onPoseResults(results) {
  if (isPreviewing) return; // 如果正在預覽照片，就不更新畫面和比對

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (mode === 'guide' && targetLandmarks) {
    drawConnectors(ctx, targetLandmarks, POSE_CONNECTIONS, {color: 'rgba(255, 215, 0, 0.6)', lineWidth: 5});
  }

  if (results.poseLandmarks) {
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 3});
    
    if (isCapturing) {
      targetLandmarks = JSON.parse(JSON.stringify(results.poseLandmarks));
      setStatus('✅ 姿勢已鎖定！請按進入引導模式');
      capture1Btn.style.display = 'none';
      guideBtn.style.display = 'block';
      isCapturing = false;
    }
    
    if (mode === 'guide' && targetLandmarks) {
      let score = calculateMatchScore(results.poseLandmarks, targetLandmarks);
      matchScoreDiv.innerText = `匹配度: ${score.toFixed(0)}%`;
      
      // 分數達標且不在預覽狀態時自動拍照
      if (score >= 85) {
        matchScoreDiv.style.background = 'rgba(40,167,69,0.9)';
        takePhoto(); 
      } else {
        matchScoreDiv.style.background = 'rgba(255,165,0,0.8)';
      }
    }
  }
  ctx.restore();
}

// ====== 相機與按鈕 ======
startBtn.onclick = async () => {
  setStatus('載入相機...');
  startBtn.disabled = true;
  try {
    // 改用不限制死長寬比，讓系統根據直橫自動決定
    const idealConstraints = { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
    const stream = await navigator.mediaDevices.getUserMedia(idealConstraints)
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
    
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      resizeCanvas(); // 初始化尺寸
      video.play().then(() => {
        capture1Btn.disabled = false; setStatus('✅ 對準人物，按下鎖定姿勢');
        startBtn.style.display = 'none';
        
        async function detect() { 
          if (video.readyState >= 2 && !isPreviewing) await pose.send({image: video}); 
          requestAnimationFrame(detect); 
        }
        detect();
      });
    };
  } catch (err) { setStatus(`❌ 失敗: ${err.name}`); }
};

capture1Btn.onclick = () => { isCapturing = true; };
guideBtn.onclick = () => {
  mode = 'guide';
  guideBtn.style.display = 'none';
  matchScoreDiv.style.display = 'block';
  setStatus('退開並讓下一個人站進黃色虛擬線內');
};