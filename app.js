console.log('PoseGuide app.js v10 - AR 偶像同框模式');

const uploadScreen = document.getElementById('upload-screen');
const loadingMsg = document.getElementById('loading-msg');
const uploadLabel = document.getElementById('upload-label');
const fileInput = document.getElementById('file-input');
const idolImg = document.getElementById('idol-img');

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const cancelBtn = document.getElementById('cancelBtn');
const status = document.getElementById('status');
const matchScoreDiv = document.getElementById('match-score');
const flash = document.getElementById('flash');

const previewModal = document.getElementById('preview-modal');
const previewImg = document.getElementById('preview-img');
const saveBtn = document.getElementById('saveBtn');
const retryBtn = document.getElementById('retryBtn');

let stream = null;
let detector = null;
let targetPosesList = []; 
let lastPhotoBlob = null; 
let isPreviewing = false;
let isTracking = false;

function setStatus(msg) { 
  status.textContent = msg; 
  status.style.display = 'block'; 
}

const POSE_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]
];

// ====== 1. 載入 MoveNet ======
async function initTFJS() {
  try {
    await tf.ready();
    const detectorConfig = {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: true,
      trackerType: poseDetection.TrackerType.BoundingBox
    };
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
    
    loadingMsg.style.display = 'none';
    uploadLabel.style.display = 'block';
  } catch (error) {
    loadingMsg.textContent = '❌ AI 載入失敗';
  }
}
initTFJS();

// ====== 2. 處理照片上傳與抽取骨架 ======
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  idolImg.src = url;
  idolImg.onload = async () => {
    setStatus('正在分析偶像骨架...');
    uploadScreen.style.display = 'none';
    cancelBtn.style.display = 'block';
    
    // 掃描靜態圖片
    const poses = await detector.estimatePoses(idolImg);
    if (poses && poses.length > 0) {
      targetPosesList = poses; // 存下照片中的骨架
      setStatus(`✅ 成功抓取 ${poses.length} 人！啟動相機中...`);
      startCamera();
    } else {
      setStatus('❌ 照片中找不到人物，請重選');
      setTimeout(resetApp, 2000);
    }
  };
};

function resizeCanvas() {
  if (video.videoWidth > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => { setTimeout(resizeCanvas, 300); });

// ====== 3. 啟動相機 ======
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      resizeCanvas();
      video.play().then(() => {
        matchScoreDiv.style.display = 'block';
        setStatus('請套進黃色虛擬線內！');
        isTracking = true;
        renderLoop(); 
      });
    };
  } catch (err) { setStatus(`❌ 相機失敗: ${err.name}`); }
}

// ====== 4. 繪圖與合成 ======
function drawKeypointsAndBones(keypoints, color, lineWidth, imgScaleX, imgScaleY) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  
  // 針對原圖比例轉換至 Canvas 螢幕比例
  const getX = (x) => x * imgScaleX;
  const getY = (y) => y * imgScaleY;

  for (let kp of keypoints) {
    if (kp.score > 0.3) {
      ctx.beginPath(); ctx.arc(getX(kp.x), getY(kp.y), 4, 0, 2 * Math.PI); ctx.fill();
    }
  }
  for (let [i, j] of POSE_CONNECTIONS) {
    const kp1 = keypoints[i]; const kp2 = keypoints[j];
    if (kp1.score > 0.3 && kp2.score > 0.3) {
      ctx.beginPath(); ctx.moveTo(getX(kp1.x), getY(kp1.y)); ctx.lineTo(getX(kp2.x), getY(kp2.y)); ctx.stroke();
    }
  }
}

function calculateMatchScore(currentKps, targetPoses, scaleX, scaleY) {
  if (targetPoses.length === 0) return 0;
  let bestScore = 0;
  for(let targetPose of targetPoses) {
    let totalDist = 0; let validPoints = 0;
    for(let i=0; i<17; i++) {
      if(currentKps[i].score > 0.3 && targetPose.keypoints[i].score > 0.3) {
        // 目標骨架需乘上縮放比例
        let targetX = targetPose.keypoints[i].x * scaleX;
        let targetY = targetPose.keypoints[i].y * scaleY;
        let dx = currentKps[i].x - targetX;
        let dy = currentKps[i].y - targetY;
        totalDist += Math.sqrt(dx*dx + dy*dy);
        validPoints++;
      }
    }
    if (validPoints > 5) {
      let score = Math.max(0, 100 - ((totalDist / validPoints) / 5));
      if (score > bestScore) bestScore = score;
    }
  }
  return bestScore;
}

// ====== 5. 核心迴圈 ======
async function renderLoop() {
  if (!isTracking || isPreviewing || video.readyState < 2) {
    requestAnimationFrame(renderLoop); return;
  }
    
  const poses = await detector.estimatePoses(video);
  
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // 1. 畫相機畫面 (底層)
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 計算原圖到相機畫面的縮放比例 (Object-fit: cover 的簡易模擬)
  const scaleX = canvas.width / idolImg.width;
  const scaleY = canvas.height / idolImg.height;

  // 2. 畫上傳的偶像照片 (半透明疊加)
  ctx.globalAlpha = 0.4; // 40% 透明度
  ctx.drawImage(idolImg, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1.0;

  // 3. 畫目標偶像骨架 (黃線)
  if (targetPosesList.length > 0) {
    targetPosesList.forEach(targetPose => {
      drawKeypointsAndBones(targetPose.keypoints, 'rgba(255, 215, 0, 0.6)', 5, scaleX, scaleY);
    });
  }

  // 4. 畫玩家骨架 (綠線) 與算分
  if (poses && poses.length > 0) {
    let totalScore = 0; let validPeopleCount = 0;

    for (const pose of poses) {
      if (pose.score > 0.2) {
        drawKeypointsAndBones(pose.keypoints, '#00FF00', 3, 1, 1);
        totalScore += calculateMatchScore(pose.keypoints, targetPosesList, scaleX, scaleY);
        validPeopleCount++;
      }
    }

    if (targetPosesList.length > 0 && validPeopleCount > 0) {
      let finalScore = totalScore / validPeopleCount;
      matchScoreDiv.innerText = `匹配度: ${finalScore.toFixed(0)}%`;
      
      if (finalScore >= 80) {
        matchScoreDiv.style.background = 'rgba(40,167,69,0.9)';
        takePhoto(scaleX, scaleY);
      } else {
        matchScoreDiv.style.background = 'rgba(255,165,0,0.8)';
      }
    }
  }
  ctx.restore();
  
  requestAnimationFrame(renderLoop);
}

// ====== 6. 拍照合成 ======
async function takePhoto(scaleX, scaleY) {
  if (isPreviewing) return; 
  isPreviewing = true;
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  // 建立合成畫布
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth; tempCanvas.height = video.videoHeight;
  const tCtx = tempCanvas.getContext('2d');
  
  // 合成：底層相機 + 表層偶像照片 (全透明度)
  tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
  tCtx.globalAlpha = 0.5; // 合成時保留一點半透明感，讓兩人融合
  tCtx.drawImage(idolImg, 0, 0, tempCanvas.width, tempCanvas.height);
  
  tempCanvas.toBlob((blob) => {
    lastPhotoBlob = blob;
    previewImg.src = URL.createObjectURL(blob);
    previewModal.style.display = 'flex';
    setStatus('📸 合成成功！');
  }, 'image/jpeg', 1.0);
}

// ====== 儲存與重設 ======
saveBtn.onclick = async () => {
  const file = new File([lastPhotoBlob], `AR_Idol_${Date.now()}.jpg`, { type: 'image/jpeg' });
  if (navigator.share && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'AR Idol Photo' }); setStatus('✅ 已儲存'); } catch (err) {}
  } else {
    const link = document.createElement('a'); link.href = URL.createObjectURL(lastPhotoBlob); link.download = file.name; link.click();
  }
  closePreview();
};

retryBtn.onclick = () => { closePreview(); setStatus('繼續引導中...'); };
function closePreview() { previewModal.style.display = 'none'; setTimeout(() => { isPreviewing = false; }, 1000); }

cancelBtn.onclick = resetApp;
function resetApp() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  isTracking = false; video.style.display = 'none'; canvas.style.display = 'none';
  matchScoreDiv.style.display = 'none'; cancelBtn.style.display = 'none'; status.style.display = 'none';
  uploadScreen.style.display = 'flex'; fileInput.value = '';
}