const fs = require('fs');

// 1. CSV 파일 읽기 (보이지 않는 특수 기호 BOM 제거 처리)
let csv = fs.readFileSync('./_data/list.csv', 'utf-8');
if (csv.charCodeAt(0) === 0xFEFF) {
  csv = csv.substr(1);
}

const rows = csv.split('\n').filter(line => line.trim() !== '');

// 2. 첫 번째 줄(헤더) 분석
const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''));

// 찾으려는 컬럼 후보들 (이 중 하나라도 포함되면 이름 컬럼으로 인식합니다)
const nameKeywords = ['이름', '연예인', '인물', 'name', 'celeb'];
const nameIdx = headers.findIndex(h => 
  nameKeywords.some(key => h.toLowerCase().includes(key))
);

if (nameIdx === -1) {
  console.error('--------------------------------------------------');
  console.error('에러: CSV 파일에서 이름 컬럼을 찾을 수 없습니다.');
  console.error('현재 인식된 컬럼명들:', headers);
  console.error('파일 첫 줄에 "이름" 이라는 글자가 있는지 확인해 주세요.');
  console.error('--------------------------------------------------');
  process.exit(1);
}

// 3. 중복 없는 이름 추출
const celebs = new Set();
for (let i = 1; i < rows.length; i++) {
  const cols = rows[i].split(',');
  if (cols[nameIdx]) {
    const name = cols[nameIdx].replace(/["\r]/g, '').trim();
    if (name && name !== '') {
      celebs.add(name);
    }
  }
}

// 4. _celebs 폴더 생성 및 파일 쓰기
if (!fs.existsSync('./_celebs')) {
  fs.mkdirSync('./_celebs');
}

celebs.forEach(name => {
  // 파일명에 포함될 수 없는 특수문자 제거
  const safeFileName = name.replace(/[\\/:*?"<>|]/g, '');
  const content = `---\ntitle: ${name}\nlayout: celeb\n---\n`;
  fs.writeFileSync(`./_celebs/${safeFileName}.md`, content, 'utf-8');
});

console.log('--------------------------------------------------');
console.log(`성공: 총 ${celebs.size}명의 개별 문서가 생성되었습니다 .`);
console.log('--------------------------------------------------');
