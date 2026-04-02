console.log('PoseGuide app.js v14 - 高畫質去背與模型 CDN 修復');

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
let targetPosesList = []; 
let lastPhotoBlob = null; 
let isPreviewing = false;
let isTracking = false;

// 偶像圖片變換參數
let idolX = 0, idolY = 0, idolScale = 1;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let initialPinchDist = null, initialScale = 1;

function setStatus(msg) { status.textContent = msg; status.style.display = 'block'; }

const POSE_CONNECTIONS = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 6], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]
];

// ====== 1. 初始化骨架模型 ======
async function initTFJS() {
  try {
    await tf.ready();
    poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: true, trackerType: poseDetection.TrackerType.BoundingBox
    });
    loadingMsg.style.display = 'none'; uploadLabel.style.display = 'block';
  } catch (error) { loadingMsg.textContent = '❌ AI 載入失敗'; console.error(error); }
}
initTFJS();

// ====== 2. 超高畫質去背 (Img.ly) ======
fileInput.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  setStatus('啟動精準去背魔法 (首次需下載模型，請稍候)...');
  uploadScreen.style.display = 'none'; cancelBtn.style.display = 'block';
  
  try {
    // 呼叫 imgly 去背引擎，並強制指定模型 CDN 來源
    const imageBlob = await imglyRemoveBackground(file, {
      // 確保跨域下載模型檔案不會失敗
      publicPath: 'https://unpkg.com/@imgly/background-removal@1.4.3/dist/',
      model: 'isnet_fp16', // 使用輕量快速版模型 (約 40MB)
      progress: (key, current, total) => {
        const percent = Math.round((current / total) * 100);
        setStatus(`去背中: ${percent}% (首次下載可能需 10~30 秒)`);
      }
    });

    const url = URL.createObjectURL(imageBlob);
    idolImg.src = url;
    
    idolImg.onload = async () => {
      setStatus('擷取偶像姿勢中...');
      const poses = await poseDetector.estimatePoses(idolImg);
      if (poses.length > 0) {
        targetPosesList = poses;
        startCamera();
      } else {
        setStatus('❌ 找不到人像骨架，請換一張全身照片'); setTimeout(resetApp, 2000);
      }
    };
  } catch (err) {
    setStatus('❌ 去背失敗，請確保有網路連線'); console.error(err); setTimeout(resetApp, 2000);
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

  // 2. 表層偶像 (去背圖)
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