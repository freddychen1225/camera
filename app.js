console.log('PoseGuide app.js v9 - 切換為 TFJS MoveNet 多人模式');

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
let detector = null;
let targetPosesList = []; 
let isCapturing = false;
let mode = 'scan'; 
let lastPhotoBlob = null; 
let isPreviewing = false;

function setStatus(msg) { status.textContent = msg; }

// MoveNet 骨架連線定義 (17個點)
const POSE_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]
];

// ====== 1. 載入 MoveNet MultiPose ======
async function initTFJS() {
  try {
    await tf.ready();
    const detectorConfig = {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: true,
      trackerType: poseDetection.TrackerType.BoundingBox
    };
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, detectorConfig);
    
    startBtn.disabled = false;
    startBtn.textContent = '啟動相機';
    setStatus('✅ AI 載入完成，請點擊啟動');
  } catch (error) {
    console.error(error);
    setStatus('❌ AI 載入失敗');
  }
}
initTFJS();

// ====== 2. 處理畫布與攝影機 ======
function resizeCanvas() {
  if (video.videoWidth > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => { setTimeout(resizeCanvas, 300); });

startBtn.onclick = async () => {
  setStatus('載入相機...');
  startBtn.disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      resizeCanvas();
      video.play().then(() => {
        capture1Btn.disabled = false; 
        setStatus('✅ 對準人物，按下鎖定背景');
        startBtn.style.display = 'none';
        renderLoop(); 
      });
    };
  } catch (err) { setStatus(`❌ 相機失敗: ${err.name}`); }
};

// ====== 3. 手動繪製骨架 ======
function drawKeypointsAndBones(keypoints, color, lineWidth) {
  // 畫點
  ctx.fillStyle = color;
  for (let kp of keypoints) {
    if (kp.score > 0.3) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  // 畫線
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  for (let [i, j] of POSE_CONNECTIONS) {
    const kp1 = keypoints[i];
    const kp2 = keypoints[j];
    if (kp1.score > 0.3 && kp2.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.stroke();
    }
  }
}

// ====== 4. 相似度計算 ======
function calculateMatchScore(currentKps, targetPoses) {
  if (targetPoses.length === 0) return 0;
  let bestScore = 0;
  
  for(let targetPose of targetPoses) {
    let totalDist = 0;
    let validPoints = 0;
    
    for(let i=0; i<17; i++) {
      if(currentKps[i].score > 0.3 && targetPose.keypoints[i].score > 0.3) {
        let dx = currentKps[i].x - targetPose.keypoints[i].x;
        let dy = currentKps[i].y - targetPose.keypoints[i].y;
        totalDist += Math.sqrt(dx*dx + dy*dy);
        validPoints++;
      }
    }
    
    if (validPoints > 5) {
      let score = Math.max(0, 100 - ((totalDist / validPoints) / 5)); // 根據畫素誤差微調分母(5)
      if (score > bestScore) bestScore = score;
    }
  }
  return bestScore;
}

// ====== 5. 偵測與繪圖迴圈 ======
async function renderLoop() {
  if (!isPreviewing && video.readyState >= 2) {
    
    // 取得所有偵測到的人 (最大 6 人)
    const poses = await detector.estimatePoses(video);
    
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // 畫背景
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 畫目標黃線
    if (mode === 'guide' && targetPosesList.length > 0) {
      targetPosesList.forEach(targetPose => {
        drawKeypointsAndBones(targetPose.keypoints, 'rgba(255, 215, 0, 0.6)', 5);
      });
    }

    if (poses && poses.length > 0) {
      
      // 鎖定當下所有人的姿勢
      if (isCapturing) {
        targetPosesList = JSON.parse(JSON.stringify(poses));
        setStatus(`✅ 已鎖定 ${targetPosesList.length} 人的姿勢！`);
        capture1Btn.style.display = 'none';
        guideBtn.style.display = 'block';
        isCapturing = false;
      }

      let totalScore = 0;
      let validPeopleCount = 0;

      for (const pose of poses) {
        // 只繪製可信度高的人
        if (pose.score > 0.2) {
          drawKeypointsAndBones(pose.keypoints, '#00FF00', 3);
          
          if (mode === 'guide' && targetPosesList.length > 0) {
            totalScore += calculateMatchScore(pose.keypoints, targetPosesList);
            validPeopleCount++;
          }
        }
      }

      // 計算平均匹配度並觸發拍照
      if (mode === 'guide' && targetPosesList.length > 0 && validPeopleCount > 0) {
        let finalScore = totalScore / validPeopleCount;
        matchScoreDiv.innerText = `匹配度: ${finalScore.toFixed(0)}%`;
        
        if (finalScore >= 80) { // 稍微放寬門檻到 80，因為 TFJS 算分方式不同
          matchScoreDiv.style.background = 'rgba(40,167,69,0.9)';
          takePhoto();
        } else {
          matchScoreDiv.style.background = 'rgba(255,165,0,0.8)';
        }
      }
    }
    ctx.restore();
  }
  // 持續執行
  requestAnimationFrame(renderLoop);
}

// ====== 6. 拍照與儲存 ======
async function takePhoto() {
  if (isPreviewing) return; 
  isPreviewing = true;
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth; tempCanvas.height = video.videoHeight;
  tempCanvas.getContext('2d').drawImage(video, 0, 0);
  
  tempCanvas.toBlob((blob) => {
    lastPhotoBlob = blob;
    previewImg.src = URL.createObjectURL(blob);
    previewModal.style.display = 'flex';
    setStatus('📸 拍照成功！');
  }, 'image/jpeg', 1.0);
}

saveBtn.onclick = async () => {
  const file = new File([lastPhotoBlob], `PoseGuide_${Date.now()}.jpg`, { type: 'image/jpeg' });
  if (navigator.share && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'PoseGuide' });
      setStatus('✅ 已儲存');
    } catch (err) {}
  } else {
    const link = document.createElement('a'); link.href = URL.createObjectURL(lastPhotoBlob); link.download = file.name; link.click();
  }
  closePreview();
};

retryBtn.onclick = () => { closePreview(); setStatus('繼續引導中...'); };
function closePreview() { previewModal.style.display = 'none'; setTimeout(() => { isPreviewing = false; }, 1000); }

capture1Btn.onclick = () => { isCapturing = true; };
guideBtn.onclick = () => {
  mode = 'guide'; guideBtn.style.display = 'none'; matchScoreDiv.style.display = 'block';
  setStatus('請換人站進黃色虛擬線內');
};