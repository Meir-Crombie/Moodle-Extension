// Hebrew year strings mapped to gregorian year
const HEBREW_YEARS = [
	{str:"תשפ\"ד", num:5784}, {str:"תשפ\"ה", num:5785}, {str:"תשפ\"ו", num:5786}, {str:"תשפ\"ז", num:5787}, {str:"תשפ\"ח", num:5788}, {str:"תשפ\"ט", num:5789}, {str:"תש\"צ", num:5790}
];
const SEMESTERS = ["אלול","א","ב"];

const DEFAULT_PALETTE = [
	["#3b82f6","#818cf8","#bae6fd"], // 5784
	["#22c55e","#4ade80","#bbf7d0"], // 5785
	["#f97316","#fbbf24","#fed7aa"], // 5786
	["#f43f5e","#fda4af","#fecdd3"], // 5787
	["#a21caf","#f472b6","#f3e8ff"], // 5788
	["#2563eb","#60a5fa","#dbeafe"], // 5789
	["#b45309","#f59e42","#fde68a"]  // 5790
];

function getPaletteFromStorage() {
	return new Promise((resolve) => {
		chrome.storage.sync.get({ paletteByYearHeb: null }, res => {
			if (Array.isArray(res.paletteByYearHeb)) return resolve(res.paletteByYearHeb);
			resolve(DEFAULT_PALETTE);
		});
	});
}

function savePaletteToStorage(palette) {
	return new Promise((resolve) => {
		chrome.storage.sync.set({ paletteByYearHeb: palette }, () => resolve());
	});
}

function render() {
	const tb = document.getElementById('palette-table');
	getPaletteFromStorage().then((palette) => {
		let html = '<tr><th>שנה\\סמסטר</th>';
		for (let sem of SEMESTERS) html += '<th>'+sem+'</th>';
		html += '</tr>';
		for (let r = 0; r < HEBREW_YEARS.length; ++r) {
			html += `<tr><td label="year"><b>${HEBREW_YEARS[r].str}</b></td>`;
			for (let c = 0; c < SEMESTERS.length; ++c) {
				html += `<td><input type="color" id="c_${r}_${c}" value="${palette[r][c]}"></td>`;
			}
			html += '</tr>';
		}
		tb.innerHTML=html;
	});
}

function readPaletteFromUI() {
	const palette = [];
	for (let r=0; r<HEBREW_YEARS.length; ++r) {
		palette[r]=[];
		for (let c=0; c<SEMESTERS.length; ++c) {
			palette[r][c]=(document.getElementById(`c_${r}_${c}`)||{}).value||"#cccccc";
		}
	}
	return palette;
}

document.getElementById('save').addEventListener('click', async () => {
	const palette = readPaletteFromUI();
	await savePaletteToStorage(palette);
	alert('נשמר! רענן את המודל');
});

document.getElementById('reset').addEventListener('click', async () => {
	await savePaletteToStorage(DEFAULT_PALETTE);
	render();
});

render();
