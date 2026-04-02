// 超簡測試版，先確認載入
console.log('app.js載入成功！');
const startBtn = document.getElementById('start');
startBtn.textContent = 'app.js OK ✓';
startBtn.onclick = () => alert('JS執行成功！準備相機');
