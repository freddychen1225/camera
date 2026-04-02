console.log('PoseGuide app.js v19 - 完美洪水填充去黑底版');

const uploadScreen = document.getElementById('upload-screen');
const loadingMsg = document.getElementById('loading-msg');
const actionBtns = document.getElementById('action-btns');
const pasteBtn = document.getElementById('pasteBtn');
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
    poseDetector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
      enableTracking: true, trackerType: poseDetection.TrackerType.BoundingBox
    });
    
    loadingMsg.style.display = 'none'; 
    actionBtns.style.display = 'flex';
  } catch (error) { loadingMsg.textContent = '❌ AI 載入失敗'; console.error(error); }
}
initTFJS();

// ====== 🔥 2. 智慧邊緣去黑底魔法 (Flood Fill 演算法) ======
function removeBlackBackground(imgElement) {
  return new Promise((resolve) => {
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = imgElement.width; 
    tempCanvas.height = imgElement.height;
    const tempCtx = tempCanvas.getContext('2d');
    
    tempCtx.drawImage(imgElement, 0, 0);
    const imgData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imgData.data;
    const width = tempCanvas.width;
    const height = tempCanvas.height;

    // 記錄已處理過的像素，避免重複計算
    const visited = new Uint8Array(width * height);
    // 使用一維陣列當作堆疊 [x1, y1, x2, y2...]，效能最高
    const stack = [];

    // 判斷是否為「可消除的黑底」 (容差設25，涵蓋壓縮產生的深灰色)
    function isBlack(x, y) {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const idx = (y * width + x) * 4;
      return data[idx] < 25 && data[idx+1] < 25 && data[idx+2] < 25;
    }

    // 將圖片的四個邊緣的黑色像素加入擴散起點
    for (let x = 0; x < width; x++) {
      if (isBlack(x, 0)) stack.push(x, 0);
      if (isBlack(x, height - 1)) stack.push(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      if (isBlack(0, y)) stack.push(0, y);
      if (isBlack(width - 1, y)) stack.push(width - 1, y);
    }

    // 執行洪水擴散
    while (stack.length > 0) {
      const py = stack.pop(); // y 座標
      const px = stack.pop(); // x 座標
      const pixelIndex = py * width + px;

      if (visited[pixelIndex]) continue;
      visited[pixelIndex] = 1;

      // 把背景黑色變透明
      const dataIndex = pixelIndex * 4;
      data[dataIndex + 3] = 0;

      // 檢查周圍四個方向，如果是黑色就繼續擴散
      if (px + 1 < width && !visited[py * width + px + 1] && isBlack(px + 1, py)) stack.push(px + 1, py);
      if (px - 1 >= 0 && !visited[py * width + px - 1] && isBlack(px - 1, py)) stack.push(px - 1, py);
      if (py + 1 < height && !visited[(py + 1) * width + px] && isBlack(px, py + 1)) stack.push(px, py + 1);
      if (py - 1 >= 0 && !visited[(py - 1) * width + px] && isBlack(px, py - 1)) stack.push(px, py - 1);
    }

    tempCtx.putImageData(imgData, 0, 0);
    resolve(tempCanvas.toDataURL('image/png'));
  });
}

// ====== 3. 處理圖片核心 ======
function processImageBlob(blob) {
  setStatus('處理圖片中...');
  uploadScreen.style.display = 'none'; cancelBtn.style.display = 'block';
  
  const tempImg = new Image();
  tempImg.src = URL.createObjectURL(blob);
  
  tempImg.onload = async () => {
    setStatus('過濾黑底邊緣 (保護頭髮)...');
    // 呼叫全新的洪水填充演算法
    const transparentDataUrl = await removeBlackBackground(tempImg);
    
    idolImg.src = transparentDataUrl;
    idolImg.onload = async () => {
      const poses = await poseDetector.estimatePoses(idolImg);
      if (poses.length > 0) {
        targetPosesList = poses;
        startCamera();
      } else {
        setStatus('❌ 找不到人像骨架，請重試'); setTimeout(resetApp, 2000);
      }
    };
  };
}

// 支援一：讀取剪貼簿
pasteBtn.onclick = async () => {
  try {
    if (!navigator.clipboard) {
      alert("您的瀏覽器不支援直接貼上，請使用下方『從相簿選擇』");
      return;
    }
    const clipboardItems = await navigator.clipboard.read();
    let imageFound = false;

    for (const clipboardItem of clipboardItems) {
      const imageTypes = clipboardItem.types.filter(type => type.startsWith('image/'));
      if (imageTypes.length > 0) {
        imageFound = true;
        const type = imageTypes.includes('image/png') ? 'image/png' : imageTypes[0];
        const blob = await clipboardItem.getType(type);
        processImageBlob(blob);
        break;
      }
    }
    if (!imageFound) alert("❌ 剪貼簿內沒有圖片！請先去相簿長按人像 -> 點擊『拷貝』。");
  } catch (err) {
    alert("❌ 無法讀取剪貼簿！請確認已允許網頁存取剪貼簿，或使用下方按鈕上傳。");
    console.error(err);
  }
};

// 傳統檔案上傳
fileInput.onchange = (e) => {
  if (e.target.files[0]) processImageBlob(e.target.files[0]);
};

// ====== 4. 畫面縮放與觸控邏輯 ======
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

// ====== 5. 啟動相機 ======
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      resizeCanvas();
      video.play().then(() => {
        takePhotoBtn.style.display = 'block';
        setStatus('攝影師：請指揮對齊「綠色目標線」！');
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

// ====== 6. 核心迴圈 ======
async function renderLoop() {
  if (!isTracking || isPreviewing || video.readyState < 2) { requestAnimationFrame(renderLoop); return; }
  const poses = await poseDetector.estimatePoses(video);
  
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(idolX, idolY); ctx.scale(idolScale, idolScale);
  ctx.globalAlpha = 0.85; 
  ctx.drawImage(idolImg, 0, 0);
  ctx.globalAlpha = 1.0;
  ctx.restore();

  targetPosesList.forEach(targetPose => {
    drawKeypointsAndBones(targetPose.keypoints, 'rgba(255, 215, 0, 0.6)', 4, idolX, idolY, idolScale);
    let shoulderDist = Math.abs(targetPose.keypoints[5].x - targetPose.keypoints[6].x) * idolScale;
    let partnerOffsetX = idolX + (shoulderDist * 1.8); 
    drawKeypointsAndBones(targetPose.keypoints, 'rgba(0, 255, 0, 0.8)', 6, partnerOffsetX, idolY, idolScale);
  });

  if (poses && poses.length > 0) {
    poses.forEach(pose => {
      if (pose.score > 0.2) drawKeypointsAndBones(pose.keypoints, '#00FFFF', 3, 0, 0, 1);
    });
  }
  ctx.restore();
  requestAnimationFrame(renderLoop);
}

// ====== 7. 立即拍照合成 ======
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
  tCtx.drawImage(idolImg, 0, 0); 
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