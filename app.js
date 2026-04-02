console.log('PoseGuide app.js v12 - 自動去背與伴侶綠線');

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

// ====== 1. 初始化 AI (包含去背與骨架) ======
async function initTFJS() {
  try {
    await tf.ready();
    // 載入骨架模型
    poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: true, trackerType: poseDetection.TrackerType.BoundingBox
    });
    // 載入去背模型 (Selfie Segmentation)
    segmenter = await bodySegmentation.createSegmenter(bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation, {
      runtime: 'tfjs', modelType: 'general'
    });
    
    loadingMsg.style.display = 'none'; uploadLabel.style.display = 'block';
  } catch (error) { loadingMsg.textContent = '❌ AI 載入失敗'; console.error(error); }
}
initTFJS();

// ====== 2. 照片上傳：自動去背 + 抓取骨架 ======
fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const tempImg = new Image();
  tempImg.src = URL.createObjectURL(file);
  
  tempImg.onload = async () => {
    setStatus('1/2 正在自動去背 (請稍候)...');
    uploadScreen.style.display = 'none'; cancelBtn.style.display = 'block';
    
    // 執行自動去背
    const segmentation = await segmenter.segmentPeople(tempImg);
    const fgColor = {r: 0, g: 0, b: 0, a: 255};
    const bgColor = {r: 0, g: 0, b: 0, a: 0};
    const maskData = await bodySegmentation.toBinaryMask(segmentation, fgColor, bgColor);
    
    // 將去背結果繪製到臨時 Canvas 並設定為透明
    const offCanvas = document.createElement('canvas');
    offCanvas.width = tempImg.width; offCanvas.height = tempImg.height;
    const offCtx = offCanvas.getContext('2d');
    offCtx.drawImage(tempImg, 0, 0);
    const imgData = offCtx.getImageData(0, 0, offCanvas.width, offCanvas.height);
    
    for(let i=0; i<maskData.data.length; i+=4) {
       if(maskData.data[i+3] === 0) { // 如果是背景
           imgData.data[i+3] = 0; // 把 Alpha 設為透明
       }
    }
    offCtx.putImageData(imgData, 0, 0);
    
    // 把去完背的透明圖片設定給 idolImg
    idolImg.src = offCanvas.toDataURL('image/png');
  };
};

idolImg.onload = async () => {
  if(!idolImg.src.startsWith('data:')) return; // 防止空載入
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
    // 初始化位置 (置中偏左)
    idolScale = (canvas.width * 0.4) / idolImg.width;
    idolX = canvas.width * 0.1; 
    idolY = (canvas.height - idolImg.height * idolScale) / 2; 
  }
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => { setTimeout(resizeCanvas, 300); });

// ====== 3. 觸控拖曳與縮放邏輯 ======
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

// 支援 PC
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
        setStatus('請被拍者站進「綠色目標線」內！');
        isTracking = true; renderLoop(); 
      });
    };
  } catch (err) { setStatus(`❌ 相機失敗: ${err.name}`); }
}

// 繪製骨架 (加入 offsetX, offsetY, scale 轉換)
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
  
  // 1. 底層：真實相機畫面
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  // 2. 表層：畫偶像的去背照片與黃線
  ctx.save();
  ctx.translate(idolX, idolY); ctx.scale(idolScale, idolScale);
  ctx.globalAlpha = 0.85; // 照片 85% 透明度，比較好抓位置
  ctx.drawImage(idolImg, 0, 0);
  ctx.globalAlpha = 1.0;
  ctx.restore();

  // 畫偶像黃色骨架
  targetPosesList.forEach(targetPose => {
    drawKeypointsAndBones(targetPose.keypoints, 'rgba(255, 215, 0, 0.6)', 4, idolX, idolY, idolScale);
    
    // 🔥 設計伴侶的「綠色引導線」 (假定在偶像右方一定的肩寬距離)
    // 這裡只是簡單平移，實務上可做更多角度設計
    let shoulderDist = Math.abs(targetPose.keypoints[5].x - targetPose.keypoints[6].x) * idolScale;
    let partnerOffsetX = idolX + (shoulderDist * 1.8); // 移到偶像旁邊
    drawKeypointsAndBones(targetPose.keypoints, 'rgba(0, 255, 0, 0.8)', 6, partnerOffsetX, idolY, idolScale);
  });

  // 3. 畫被拍者的即時骨架 (使用淺藍色，避免與綠色目標混淆)
  if (poses && poses.length > 0) {
    poses.forEach(pose => {
      if (pose.score > 0.2) drawKeypointsAndBones(pose.keypoints, '#00FFFF', 3, 0, 0, 1);
    });
  }
  ctx.restore();
  
  requestAnimationFrame(renderLoop);
}

// ====== 6. 攝影師立即拍照 ======
takePhotoBtn.onclick = () => {
  isPreviewing = true;
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = canvas.width; tempCanvas.height = canvas.height;
  const tCtx = tempCanvas.getContext('2d');
  
  // 合成：底層相機 + 表層「已去背的偶像圖片」
  tCtx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
  
  tCtx.save();
  tCtx.translate(idolX, idolY);
  tCtx.scale(idolScale, idolScale);
  tCtx.drawImage(idolImg, 0, 0); // 100% 實體合成
  tCtx.restore();
  
  tempCanvas.toBlob((blob) => {
    lastPhotoBlob = blob;
    previewImg.src = URL.createObjectURL(blob);
    previewModal.style.display = 'flex';
    setStatus('📸 合成成功！');
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