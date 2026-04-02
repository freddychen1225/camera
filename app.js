// 引入新版 MediaPipe Tasks
import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0";

console.log('PoseGuide app.js v8 - 多人追蹤與 iOS 儲存修復');

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start');
const capture1Btn = document.getElementById('capture1');
const guideBtn = document.getElementById('guideBtn');
const status = document.getElementById('status');
const matchScoreDiv = document.getElementById('match-score');
const flash = document.getElementById('flash');

const previewModal = document.getElementById('preview-modal');
const previewImg = document.getElementById('preview-img');
const saveBtn = document.getElementById('saveBtn');
const retryBtn = document.getElementById('retryBtn');

let stream = null;
let poseLandmarker = null;
let runningMode = "VIDEO";
let targetLandmarksList = []; // 改為陣列，存儲多人的骨架
let isCapturing = false;
let mode = 'scan'; 
let lastPhotoBlob = null; // 用 Blob 儲存給 iOS 分享用
let isPreviewing = false;
let lastVideoTime = -1;

function setStatus(msg) { status.textContent = msg; }

// ====== 初始化新版 MediaPipe (支援多人) ======
async function createPoseLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU"
    },
    runningMode: runningMode,
    numPoses: 3 // 🔥 這裡設定最高同時追蹤 3 個人！
  });
  
  startBtn.disabled = false;
  startBtn.textContent = '啟動相機';
  setStatus('✅ AI 載入完成，請點擊啟動');
}
createPoseLandmarker();

// ====== 處理螢幕旋轉防縮放 ======
function resizeCanvas() {
  if (video.videoWidth > 0) {
    // 確保 canvas 始終與影片真實比例一致
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 300); // 延遲等待 iOS 轉向完成
});

// ====== 計算匹配度 ======
// 現在會算出畫面上的人與「所有」目標線的最短距離
function calculateMatchScore(currentLandmarks, targetsList) {
  if (targetsList.length === 0) return 0;
  
  let bestScore = 0;
  // 這個人會去跟目標裡的每一個人比對，看跟誰最像
  for(let target of targetsList) {
    let totalDist = 0;
    for(let i=0; i<33; i++) {
      let dx = currentLandmarks[i].x - target[i].x;
      let dy = currentLandmarks[i].y - target[i].y;
      totalDist += Math.sqrt(dx*dx + dy*dy);
    }
    let score = Math.max(0, 100 - ((totalDist / 33) * 300));
    if (score > bestScore) bestScore = score;
  }
  return bestScore;
}

// ====== iOS 儲存相片 (Web Share API) ======
async function takePhoto() {
  if (isPreviewing) return; 
  isPreviewing = true;
  
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  tempCanvas.getContext('2d').drawImage(video, 0, 0);
  
  // 為了 iOS Share API，我們需要轉成 Blob
  tempCanvas.toBlob((blob) => {
    lastPhotoBlob = blob;
    const url = URL.createObjectURL(blob);
    previewImg.src = url;
    previewModal.style.display = 'flex';
    setStatus('📸 拍照成功！');
  }, 'image/jpeg', 1.0);
}

saveBtn.onclick = async () => {
  const file = new File([lastPhotoBlob], `PoseGuide_${Date.now()}.jpg`, { type: 'image/jpeg' });
  
  // 🔥 iOS 專用：呼叫原生分享面板，裡面會有「儲存影像」
  if (navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: 'PoseGuide 完美照片',
      });
      setStatus('✅ 已呼叫儲存/分享');
    } catch (err) {
      console.log('分享取消或失敗', err);
    }
  } else {
    // 備用方案 (PC 或不支援的環境)
    const link = document.createElement('a');
    link.href = URL.createObjectURL(lastPhotoBlob);
    link.download = file.name;
    link.click();
    setStatus('✅ 照片已下載');
  }
  closePreview();
};

retryBtn.onclick = () => {
  closePreview();
  setStatus('繼續引導中...');
};

function closePreview() {
  previewModal.style.display = 'none';
  setTimeout(() => { isPreviewing = false; }, 1000); 
}

// ====== 繪圖與偵測迴圈 ======
// 連結輔助線 (新版常數)
const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
];

async function renderLoop() {
  if (!isPreviewing && video.readyState >= 2) {
    // 檢查影片是否更新
    let startTimeMs = performance.now();
    if (lastVideoTime !== video.currentTime) {
      lastVideoTime = video.currentTime;
      // 進行 AI 偵測
      const poseLandmarkerResult = poseLandmarker.detectForVideo(video, startTimeMs);
      
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 畫出目標黃線 (多人)
      if (mode === 'guide' && targetLandmarksList.length > 0) {
        targetLandmarksList.forEach(target => {
          drawConnectors(ctx, target, POSE_CONNECTIONS, {color: 'rgba(255, 215, 0, 0.6)', lineWidth: 5});
        });
      }

      // 如果有偵測到人
      if (poseLandmarkerResult.landmarks) {
        
        if (isCapturing) {
          // 鎖定當下畫面上「所有人」的姿勢
          targetLandmarksList = JSON.parse(JSON.stringify(poseLandmarkerResult.landmarks));
          setStatus(`✅ 已鎖定 ${targetLandmarksList.length} 人的姿勢！請按引導模式`);
          capture1Btn.style.display = 'none';
          guideBtn.style.display = 'block';
          isCapturing = false;
        }

        let totalScore = 0;
        let peopleCount = poseLandmarkerResult.landmarks.length;

        for (const landmark of poseLandmarkerResult.landmarks) {
          drawConnectors(ctx, landmark, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 3});
          
          if (mode === 'guide' && targetLandmarksList.length > 0) {
            totalScore += calculateMatchScore(landmark, targetLandmarksList);
          }
        }

        // 計算平均匹配度
        if (mode === 'guide' && targetLandmarksList.length > 0 && peopleCount > 0) {
          let finalScore = totalScore / peopleCount;
          matchScoreDiv.innerText = `匹配度: ${finalScore.toFixed(0)}%`;
          
          if (finalScore >= 85) {
            matchScoreDiv.style.background = 'rgba(40,167,69,0.9)';
            takePhoto();
          } else {
            matchScoreDiv.style.background = 'rgba(255,165,0,0.8)';
          }
        }
      }
      ctx.restore();
    }
  }
  requestAnimationFrame(renderLoop);
}

// ====== 相機啟動 ======
startBtn.onclick = async () => {
  setStatus('載入相機...');
  startBtn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'environment' }, 
      audio: false 
    });
    
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      resizeCanvas();
      video.play().then(() => {
        capture1Btn.disabled = false; 
        setStatus('✅ 對準人物，按下鎖定背景');
        startBtn.style.display = 'none';
        renderLoop(); // 啟動繪圖與偵測迴圈
      });
    };
  } catch (err) { setStatus(`❌ 失敗: ${err.name}`); }
};

capture1Btn.onclick = () => { isCapturing = true; };
guideBtn.onclick = () => {
  mode = 'guide';
  guideBtn.style.display = 'none';
  matchScoreDiv.style.display = 'block';
  setStatus('請換人站進黃色虛擬線內');
};