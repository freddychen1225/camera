console.log('PoseGuide app.js v15 - 官方去背引擎 + 邊緣平滑羽化');

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
const flash = document.getElementById('flash');

const previewModal = document.getElementById('preview-modal');
const previewImg = document.getElementById('preview-img');
const saveBtn = document.getElementById('saveBtn');
const retryBtn = document.getElementById('retryBtn');

let stream = null;
let poseDetector = null;
let segmenter = null;
let targetPosesList = []; 
let lastPhotoBlob = null; 
let isPreviewing = false;
let isTracking = false;

let idolX = 0, idolY = 0, idolScale = 1;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let initialPinchDist = null, initialScale = 1;

function setStatus(msg) { status.textContent = msg; status.style.display = 'block'; }

const POSE_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]
];

// ====== 1. 初始化官方 AI 模組 ======
async function initTFJS() {
  try {
    await tf.ready();
    poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: true, trackerType: poseDetection.TrackerType.BoundingBox
    });
    segmenter = await bodySegmentation.createSegmenter(bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation, {
      runtime: 'tfjs', modelType: 'general'
    });
    
    loadingMsg.style.display = 'none'; uploadLabel.style.display = 'block';
  } catch (error) { loadingMsg.textContent = '❌ AI 載入失敗'; console.error(error); }
}
initTFJS();

// ====== 2. 照片上傳：自動去背 + 【邊緣羽化平滑】 ======
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const tempImg = new Image();
  tempImg.src = URL.createObjectURL(file);
  
  tempImg.onload = async () => {
    setStatus('1/2 正在自動去背 (含邊緣平滑處理)...');
    uploadScreen.style.display = 'none'; cancelBtn.style.display = 'block';
    
    try {
      // 1. 取得人物遮罩
      const segmentation = await segmenter.segmentPeople(tempImg);
      const fgColor = {r: 255, g: 255, b: 255, a: 255}; // 人物變白
      const bgColor = {r: 0, g: 0, b: 0, a: 0};         // 背景變黑
      const maskData = await bodySegmentation.toBinaryMask(segmentation, fgColor, bgColor);
      
      // 2. 準備遮罩 Canvas
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = tempImg.width; maskCanvas.height = tempImg.height;
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.putImageData(maskData, 0, 0);

      // 3. 邊緣羽化 (Feathering) 的魔法
      // 我們把硬梆梆的遮罩稍微縮小一點點，然後加上高斯模糊
      const featherCanvas = document.createElement('canvas');
      featherCanvas.width = tempImg.width; featherCanvas.height = tempImg.height;
      const featherCtx = featherCanvas.getContext('2d');
      
      featherCtx.filter = 'blur(4px)'; // 模糊半徑 4px 讓邊緣變軟
      featherCtx.drawImage(maskCanvas, 0, 0);
      featherCtx.filter = 'none';

      // 4. 最終合成：把原圖跟「羽化後的遮罩」交集
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = tempImg.width; finalCanvas.height = tempImg.height;
      const finalCtx = finalCanvas.getContext('2d');
      
      // 先畫遮罩
      finalCtx.drawImage(featherCanvas, 0, 0);
      // 利用 source-in 模式，只保留遮罩範圍內的原圖，且繼承邊緣的半透明模糊
      finalCtx.globalCompositeOperation = 'source-in';
      finalCtx.drawImage(tempImg, 0, 0);
      finalCtx.globalCompositeOperation = 'source-over'; // 恢復預設
      
      // 5. 設定給 idolImg
      idolImg.src = finalCanvas.toDataURL('image/png');
    } catch(err) {
      setStatus('❌ 去背過程發生錯誤'); console.error(err);
    }
  };
};

idolImg.onload = async () => {
  if(!idolImg.src.startsWith('data:')) return; 
  setStatus('2/2 提取偶像姿勢...');
  
  const poses = await poseDetector.estimatePoses(idolImg);
  if (poses.length > 0) {
    targetPosesList = poses;
    startCamera();
  } else {
    setStatus('❌ 找不到人像骨架，請重選'); setTimeout(resetApp, 2000);
  }
};

function resizeCanvas() {
  if (video.videoWidth > 0) {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    idolScale = (canvas.width * 0.4) / idolImg.width;
    idolX = canvas.width * 0.1; 
    idolY = (canvas.height - idolImg.height * idolScale) / 2; 
  }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => { setTimeout(resizeCanvas, 300); });

// ====== 3. 觸控拖曳與縮放 ======
function getPinchDist(e) { return Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
canvas.addEventListener('touchstart', e => {
  if(e.touches.length === 1) { isDragging = true; dragStartX = e.touches[0].clientX - idolX; dragStartY = e.touches[0].clientY - idolY; } 
  else if(e.touches.length === 2) { isDragging = false; initialPinchDist = getPinchDist(e); initialScale = idolScale; }
});
canvas.addEventListener('touchmove', e => {
  e.preventDefault(); 
  if(e.touches.length === 1 && isDragging) { idolX = e.touches[0].clientX - dragStartX; idolY = e.touches[0].clientY - dragStartY; } 
  else if(e.touches.length === 2 && initialPinchDist) { idolScale = initialScale * (getPinchDist(e) / initialPinchDist); }
});
canvas.addEventListener('touchend', () => { isDragging = false; initialPinchDist = null; });
canvas.addEventListener('mousedown', e => { isDragging = true; dragStartX = e.clientX - idolX; dragStartY = e.clientY - idolY; });
canvas.addEventListener('mousemove', e => { if(isDragging) { idolX = e.clientX - dragStartX; idolY = e.clientY - dragStartY; } });
canvas.addEventListener('mouseup', () => isDragging = false);

// ====== 4. 啟動相機 ======
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      resizeCanvas();
      video.play().then(() => {
        takePhotoBtn.style.display = 'block';
        setStatus('攝影師模式：請指揮被拍者對齊「綠色目標線」！');
        isTracking = true; renderLoop(); 
      });
    };
  } catch (err) { setStatus(`❌ 相機失敗: ${err.name}`); }
}

function drawKeypointsAndBones(keypoints, color, lineWidth, offsetX, offsetY, scale) {
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
  const getX = (x) => (x * scale) + offsetX;
  const getY = (y) => (y * scale) + offsetY;

  for (let kp of keypoints) {
    if (kp.score > 0.3) { ctx.beginPath(); ctx.arc(getX(kp.x), getY(kp.y), 4, 0, 2 * Math.PI); ctx.fill(); }
  }
  for (let [i, j] of POSE_CONNECTIONS) {
    const kp1 = keypoints[i]; const kp2 = keypoints[j];
    if (kp1.score > 0.3 && kp2.score > 0.3) {
      ctx.beginPath(); ctx.moveTo(getX(kp1.x), getY(kp1.y)); ctx.lineTo(getX(kp2.x), getY(kp2.y)); ctx.stroke();
    }
  }
}

// ====== 5. 核心迴圈 ======
async function renderLoop() {
  if (!isTracking || isPreviewing || video.readyState < 2) { requestAnimationFrame(renderLoop); return; }
  const poses = await poseDetector.estimatePoses(video);
  
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // 1. 底層相機
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. 表層偶像 (加上了羽化去背，85% 透明度方便對位)
  ctx.save();
  ctx.translate(idolX, idolY); ctx.scale(idolScale, idolScale);
  ctx.globalAlpha = 0.85; 
  ctx.drawImage(idolImg, 0, 0);
  ctx.globalAlpha = 1.0;
  ctx.restore();

  // 畫偶像黃線 與 伴侶綠線
  targetPosesList.forEach(targetPose => {
    drawKeypointsAndBones(targetPose.keypoints, 'rgba(255, 215, 0, 0.6)', 4, idolX, idolY, idolScale);
    
    // 生成右側的綠色引導線
    let shoulderDist = Math.abs(targetPose.keypoints[5].x - targetPose.keypoints[6].x) * idolScale;
    let partnerOffsetX = idolX + (shoulderDist * 1.8); 
    drawKeypointsAndBones(targetPose.keypoints, 'rgba(0, 255, 0, 0.8)', 6, partnerOffsetX, idolY, idolScale);
  });

  // 3. 畫被拍者的即時骨架 (淺藍色)
  if (poses && poses.length > 0) {
    poses.forEach(pose => {
      if (pose.score > 0.2) drawKeypointsAndBones(pose.keypoints, '#00FFFF', 3, 0, 0, 1);
    });
  }
  ctx.restore();
  requestAnimationFrame(renderLoop);
}

// ====== 6. 立即拍照合成 ======
takePhotoBtn.onclick = () => {
  isPreviewing = true;
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
  const tCtx = tempCanvas.getContext('2d');
  
  tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
  tCtx.save();
  tCtx.translate(idolX, idolY); tCtx.scale(idolScale, idolScale);
  tCtx.drawImage(idolImg, 0, 0); // 100% 實體合成
  tCtx.restore();
  
  tempCanvas.toBlob((blob) => {
    lastPhotoBlob = blob;
    previewImg.src = URL.createObjectURL(blob);
    previewModal.style.display = 'flex';
    setStatus('📸 完美合照！');
  }, 'image/jpeg', 1.0);
};

saveBtn.onclick = async () => {
  const file = new File([lastPhotoBlob], `AR_Idol_${Date.now()}.jpg`, { type: 'image/jpeg' });
  if (navigator.share && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '與偶像合照' }); setStatus('✅ 已儲存'); } catch (err) {}
  } else {
    const link = document.createElement('a'); link.href = URL.createObjectURL(lastPhotoBlob); link.download = file.name; link.click();
  }
  closePreview();
};

retryBtn.onclick = () => { closePreview(); setStatus('👉 攝影師：請指揮被拍者對齊綠線'); };
function closePreview() { previewModal.style.display = 'none'; setTimeout(() => { isPreviewing = false; }, 500); }

cancelBtn.onclick = resetApp;
function resetApp() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  isTracking = false; video.style.display = 'none'; canvas.style.display = 'none';
  takePhotoBtn.style.display = 'none'; cancelBtn.style.display = 'none'; status.style.display = 'none';
  uploadScreen.style.display = 'flex'; fileInput.value = '';
}