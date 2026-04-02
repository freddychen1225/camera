console.log('PoseGuide app.js v6 - 虛擬線比對與自動拍照');

const video = document.getElementById('video');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start');
const capture1Btn = document.getElementById('capture1');
const guideBtn = document.getElementById('guideBtn');
const status = document.getElementById('status');
const matchScoreDiv = document.getElementById('match-score');
const flash = document.getElementById('flash');

let stream = null;
let targetLandmarks = null;
let isCapturing = false;
let mode = 'scan'; // 'scan' = 掃描背景, 'guide' = 姿態比對
let lastPhotoTime = 0; // 防連續狂拍

function setStatus(msg) { status.textContent = msg; }

// ====== 相似度計算 (歐式距離) ======
function calculateMatchScore(current, target) {
  let totalDist = 0;
  for(let i=0; i<33; i++) { // MediaPipe 有 33 個關鍵點
    let dx = current[i].x - target[i].x;
    let dy = current[i].y - target[i].y;
    totalDist += Math.sqrt(dx*dx + dy*dy);
  }
  let avgDist = totalDist / 33;
  // 將距離轉換為 0~100 分。距離越小分數越高。 (常數 300 可依靈敏度微調)
  let score = Math.max(0, 100 - (avgDist * 300));
  return score;
}

// ====== 拍照特效與存檔 ======
function takePhoto() {
  const now = Date.now();
  if (now - lastPhotoTime < 3000) return; // 拍完冷卻 3 秒
  lastPhotoTime = now;
  
  // 畫面閃白
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 150);
  
  // 存下這張照片
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  
  // 實務上這裡可以提供下載，或存入相簿
  console.log('📸 喀嚓！拍照成功！');
  setStatus('📸 拍照成功！');
  
  // 短暫預覽照片
  setTimeout(() => setStatus('繼續引導中...'), 2000);
}

// ====== MediaPipe Pose ======
const pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}` });
pose.setOptions({ modelComplexity: 0, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
pose.onResults(onPoseResults);

function onPoseResults(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  // 如果在「引導模式」，把儲存的理想骨架畫成黃色半透明虛擬線
  if (mode === 'guide' && targetLandmarks) {
    drawConnectors(ctx, targetLandmarks, POSE_CONNECTIONS, {color: 'rgba(255, 215, 0, 0.6)', lineWidth: 5});
  }

  if (results.poseLandmarks) {
    // 畫出當前人物的綠色骨架
    drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#00FF00', lineWidth: 3});
    
    // 鎖定姿勢邏輯
    if (isCapturing) {
      targetLandmarks = JSON.parse(JSON.stringify(results.poseLandmarks));
      setStatus('✅ 姿勢已鎖定！請按進入引導模式');
      capture1Btn.style.display = 'none';
      guideBtn.style.display = 'block'; // 顯示引導按鈕
      isCapturing = false;
    }
    
    // 比對邏輯
    if (mode === 'guide' && targetLandmarks) {
      let score = calculateMatchScore(results.poseLandmarks, targetLandmarks);
      matchScoreDiv.innerText = `匹配度: ${score.toFixed(0)}%`;
      
      if (score >= 85) {
        matchScoreDiv.style.background = 'rgba(40,167,69,0.9)'; // 變綠色
        takePhoto(); // 分數達標，自動拍照！
      } else {
        matchScoreDiv.style.background = 'rgba(255,165,0,0.8)'; // 橘色
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
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 }, audio: false })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
    video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', ''); video.muted = true;
    video.srcObject = stream; video.style.display = 'block'; canvas.style.display = 'block';
    
    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
      video.play().then(() => {
        capture1Btn.disabled = false; setStatus('✅ 對準人物，按下鎖定姿勢');
        startBtn.style.display = 'none';
        
        async function detect() { if (video.readyState >= 2) await pose.send({image: video}); requestAnimationFrame(detect); }
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