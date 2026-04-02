console.log('PoseGuide app.js v11 - AR 互動拍照機 (支援拖曳縮放)');

const uploadScreen = document.getElementById('upload-screen');
const loadingMsg = document.getElementById('loading-msg');
const uploadLabel = document.getElementById('upload-label');
const fileInput = document.getElementById('file-input');
const idolImg = document.getElementById('idol-img');

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const cancelBtn = document.getElementById('cancelBtn');
const takePhotoBtn = document.getElementById('takePhotoBtn');
const status = document.getElementById('status');
const countdownDiv = document.getElementById('countdown');
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
let isCountingDown = false;

// 偶像圖片變換參數 (拖曳與縮放)
let idolX = 0, idolY = 0, idolScale = 1;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let initialPinchDist = null, initialScale = 1;

function setStatus(msg) { status.textContent = msg; status.style.display = 'block'; }

const POSE_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]
];

// ====== 1. 初始化 AI ======
async function initTFJS() {
  try {
    await tf.ready();
    detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: true, trackerType: poseDetection.TrackerType.BoundingBox
    });
    loadingMsg.style.display = 'none'; uploadLabel.style.display = 'block';
  } catch (error) { loadingMsg.textContent = '❌ AI 載入失敗'; }
}
initTFJS();

// ====== 2. 照片上傳與分析 ======
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  idolImg.src = URL.createObjectURL(file);
  idolImg.onload = async () => {
    setStatus('分析偶像動作中...');
    uploadScreen.style.display = 'none'; cancelBtn.style.display = 'block';
    
    const poses = await detector.estimatePoses(idolImg);
    if (poses.length > 0) {
      targetPosesList = poses;
      startCamera();
    } else {
      setStatus('❌ 找不到人像，請重選'); setTimeout(resetApp, 2000);
    }
  };
};

function resizeCanvas() {
  if (video.videoWidth > 0) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    // 初始化偶像位置與大小 (預設寬度縮放至畫面的一半)
    idolScale = (canvas.width * 0.5) / idolImg.width;
    idolX = canvas.width * 0.1; // 靠左
    idolY = (canvas.height - idolImg.height * idolScale) / 2; // 垂直置中
  }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => { setTimeout(resizeCanvas, 300); });

// ====== 3. 觸控拖曳與縮放邏輯 ======
function getPinchDist(e) {
  return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
}

canvas.addEventListener('touchstart', e => {
  if(e.touches.length === 1) {
    isDragging = true;
    // 簡單的相對移動計算
    dragStartX = e.touches[0].clientX - idolX;
    dragStartY = e.touches[0].clientY - idolY;
  } else if(e.touches.length === 2) {
    isDragging = false;
    initialPinchDist = getPinchDist(e);
    initialScale = idolScale;
  }
});

canvas.addEventListener('touchmove', e => {
  e.preventDefault(); // 防止畫面滾動
  if(e.touches.length === 1 && isDragging) {
    idolX = e.touches[0].clientX - dragStartX;
    idolY = e.touches[0].clientY - dragStartY;
  } else if(e.touches.length === 2 && initialPinchDist) {
    let currentDist = getPinchDist(e);
    idolScale = initialScale * (currentDist / initialPinchDist);
  }
});

canvas.addEventListener('touchend', () => { isDragging = false; initialPinchDist = null; });

// 支援 PC 滑鼠測試
canvas.addEventListener('mousedown', e => { isDragging = true; dragStartX = e.clientX - idolX; dragStartY = e.clientY - idolY; });
canvas.addEventListener('mousemove', e => { if(isDragging) { idolX = e.clientX - dragStartX; idolY = e.clientY - dragStartY; } });
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('wheel', e => { idolScale += e.deltaY * -0.001; idolScale = Math.max(0.1, idolScale); });

// ====== 4. 啟動相機與迴圈 ======
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      resizeCanvas();
      video.play().then(() => {
        takePhotoBtn.style.display = 'block';
        setStatus('👉 單指拖曳移動偶像，雙指縮放大小');
        isTracking = true; renderLoop(); 
      });
    };
  } catch (err) { setStatus(`❌ 相機失敗: ${err.name}`); }
}

function drawKeypointsAndBones(keypoints, color, lineWidth) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
  for (let kp of keypoints) {
    if (kp.score > 0.3) { ctx.beginPath(); ctx.arc(kp.x, kp.y, 4, 0, 2 * Math.PI); ctx.fill(); }
  }
  for (let [i, j] of POSE_CONNECTIONS) {
    const kp1 = keypoints[i]; const kp2 = keypoints[j];
    if (kp1.score > 0.3 && kp2.score > 0.3) {
      ctx.beginPath(); ctx.moveTo(kp1.x, kp1.y); ctx.lineTo(kp2.x, kp2.y); ctx.stroke();
    }
  }
}

async function renderLoop() {
  if (!isTracking || isPreviewing || video.readyState < 2) { requestAnimationFrame(renderLoop); return; }
  const poses = await detector.estimatePoses(video);
  
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // 1. 畫相機畫面
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. 應用變換矩陣，畫偶像照片與骨架
  ctx.save();
  ctx.translate(idolX, idolY);
  ctx.scale(idolScale, idolScale);
  
  ctx.globalAlpha = 0.6; // 60% 透明度，讓你方便對位
  ctx.drawImage(idolImg, 0, 0);
  ctx.globalAlpha = 1.0;
  
  targetPosesList.forEach(targetPose => {
    drawKeypointsAndBones(targetPose.keypoints, 'rgba(255, 215, 0, 0.8)', 4 / idolScale);
  });
  ctx.restore();

  // 3. 畫你的綠色骨架 (不擋臉，增加科技感)
  if (poses && poses.length > 0) {
    poses.forEach(pose => {
      if (pose.score > 0.2) drawKeypointsAndBones(pose.keypoints, '#00FF00', 3);
    });
  }
  ctx.restore();
  
  requestAnimationFrame(renderLoop);
}

// ====== 5. 倒數拍照與合成 ======
takePhotoBtn.onclick = () => {
  if(isCountingDown) return;
  isCountingDown = true;
  takePhotoBtn.disabled = true;
  
  let count = 3;
  countdownDiv.style.display = 'block';
  countdownDiv.innerText = count;
  
  let timer = setInterval(() => {
    count--;
    if(count > 0) {
      countdownDiv.innerText = count;
    } else {
      clearInterval(timer);
      countdownDiv.style.display = 'none';
      captureFinalImage();
    }
  }, 1000);
};

function captureFinalImage() {
  isPreviewing = true;
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
  const tCtx = tempCanvas.getContext('2d');
  
  // 畫相機底圖
  tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
  
  // 畫偶像圖 (套用完全相同的位移與縮放，但不透明)
  tCtx.save();
  tCtx.translate(idolX, idolY);
  tCtx.scale(idolScale, idolScale);
  tCtx.globalAlpha = 0.9; // 90% 不透明，保留一點點融合感
  tCtx.drawImage(idolImg, 0, 0);
  tCtx.restore();
  
  tempCanvas.toBlob((blob) => {
    lastPhotoBlob = blob;
    previewImg.src = URL.createObjectURL(blob);
    previewModal.style.display = 'flex';
    setStatus('📸 完美合照！');
    isCountingDown = false;
    takePhotoBtn.disabled = false;
  }, 'image/jpeg', 1.0);
}

saveBtn.onclick = async () => {
  const file = new File([lastPhotoBlob], `Idol_AR_${Date.now()}.jpg`, { type: 'image/jpeg' });
  if (navigator.share && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '與偶像合照' }); setStatus('✅ 已儲存'); } catch (err) {}
  } else {
    const link = document.createElement('a'); link.href = URL.createObjectURL(lastPhotoBlob); link.download = file.name; link.click();
  }
  closePreview();
};

retryBtn.onclick = () => { closePreview(); setStatus('👉 單指拖曳，雙指縮放'); };
function closePreview() { previewModal.style.display = 'none'; setTimeout(() => { isPreviewing = false; }, 500); }

cancelBtn.onclick = resetApp;
function resetApp() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  isTracking = false; video.style.display = 'none'; canvas.style.display = 'none';
  takePhotoBtn.style.display = 'none'; cancelBtn.style.display = 'none'; status.style.display = 'none';
  uploadScreen.style.display = 'flex'; fileInput.value = '';
}