// Inject small runtime tweaks after CSS applies
(function () {
	const docReady = (fn) => {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', fn, { once: true });
		} else {
			fn();
		}
	};

	const HEBREW_YEARS = [5784,5785,5786,5787,5788,5789,5790];
	const SEM_TO_IDX = {'אלול':0, '1':0, 'א':1, '2':1, 'ב':2, '3':2};
	let paletteByYearHeb = null;

	function hexToHsl(hex) {
		hex = (hex || '').replace('#','');
		if (!hex) return { h: 220, s: 60, l: 60 };
		if (hex.length === 3) hex = hex.split('').map(c=>c+c).join('');
		const r = parseInt(hex.substring(0,2),16) / 255;
		const g = parseInt(hex.substring(2,4),16) / 255;
		const b = parseInt(hex.substring(4,6),16) / 255;
		const max = Math.max(r,g,b), min = Math.min(r,g,b);
		let h, s, l = (max + min) / 2;
		if (max === min) { h = 0; s = 0; }
		else {
			const d = max - min;
			s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
			if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
		}
		h = Math.round(h % 360);
		s = Math.round((s || 0) * 100);
		l = Math.round(l * 100);
		return { h, s: Math.max(35, Math.min(90, s)), l: Math.max(35, Math.min(70, l)) };
	}

	function loadPaletteHeb() {
		return new Promise((resolve) => {
			chrome.storage.sync.get({ paletteByYearHeb: null }, res => {
				if (Array.isArray(res.paletteByYearHeb)) paletteByYearHeb = res.paletteByYearHeb;
				else paletteByYearHeb = null;
				resolve(paletteByYearHeb);
			});
		});
	}

	function parseHebrewYearAndSemester(txt) {
		let y, s;
		// Detect Hebrew year
		const yMatch = txt.match(/תש[פצ]["']?[דוהזחטצ]/);
		if (yMatch) {
			const lookup = {'תשפ"ד':5784,'תשפ"ה':5785,'תשפ"ו':5786,'תשפ"ז':5787,'תשפ"ח':5788,'תשפ"ט':5789,'תש"צ':5790};
			const cy = yMatch[0].replace("'",'"');
			y = lookup[cy];
		}
		if (!y) {
			const nMatch = txt.match(/57[8-9][0-9]/);
			y = nMatch ? parseInt(nMatch[0],10) : null;
		}
		// Detect semester
		let sMatch = null;
		if (txt.includes('אלול')) s = 0;
		else if ((sMatch = txt.match(/(?<=^|\W)(א|ב|1|2|3)(?=\W|$)/))) s = SEM_TO_IDX[sMatch[1]];
		else s = null;
		return {year: y, semIdx: s};
	}

	function colorFor(year, semIdx) {
		// Default fallback
		if (!Array.isArray(paletteByYearHeb)) return { h: 220,s:60,l:60 };
		const row = HEBREW_YEARS.indexOf(year);
		if (row === -1 || semIdx == null) return { h: 220, s: 60, l: 60 };
		let hex = paletteByYearHeb[row] && paletteByYearHeb[row][semIdx];
		if (!hex) hex = "#cccccc";
		return hexToHsl(hex);
	}

	function ensureStructureAndColor() {
		const cards = document.querySelectorAll('.jct-courses-grid > .list-group-item, .jct-courses-grid .list-group > .list-group-item, .jct-courses-grid .coursebox, .jct-courses-grid .card.course, .jct-courses-grid .course-list > li, .jct-courses-grid > .dashboard-card');
		cards.forEach((card) => {
			let topThumb = card.querySelector('.jct-thumb-wrap');
			if (!topThumb) {
				topThumb = document.createElement('div');
				topThumb.className = 'jct-thumb-wrap';
				card.insertBefore(topThumb, card.firstChild);
			}
			let img = card.querySelector('img.courseimage, .courseimage img, img[src*="pluginfile"], img[src*="/course/overview"]');
			if (img && img.parentElement !== topThumb) {
				topThumb.innerHTML = '';
				topThumb.appendChild(img);
				img.classList.add('jct-thumb-img');
			}
			if (!topThumb.querySelector('img') && !topThumb.querySelector('.jct-course-thumb')) {
				const ph = document.createElement('img');
				ph.className = 'jct-thumb-img';
				ph.alt = '';
				ph.src = getPlaceholderUrl();
				topThumb.appendChild(ph);
			}
			const text = card.innerText || '';
			const { year, semIdx } = parseHebrewYearAndSemester(text);
			const { h, s, l } = colorFor(year, semIdx);
			card.style.setProperty('--jct-accent-h', String(h));
			card.style.setProperty('--jct-accent-s', String(s) + '%');
			card.style.setProperty('--jct-accent-l', String(l) + '%');
			// Clickable logic preserved...
			let mainLink = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
			if (mainLink && !card.classList.contains('jct-clickable')) {
				card.classList.add('jct-clickable');
				card.style.cursor = 'pointer';
				card.addEventListener('click', (event) => {
					if (event.target.closest('a[href*="/course/view.php"]')) return;
					window.open(mainLink.href, '_self');
				});
			}
		});
	}

	function markCoursesContainers() {
		const selectors = [
			'.block_myoverview .courses-view',
			'.block_myoverview .list-group',
			'.block_myoverview [data-region="courses-view"] .list-group',
			'.block_myoverview .content .list-group',
			'.dashboard-card-deck',
			'#frontpage-course-list .courses',
			'#frontpage-course-list .course-list',
			'.course_category_tree .courses',
			'.course_category_tree .category-browse .courses'
		];
		const containers = document.querySelectorAll(selectors.join(','));
		containers.forEach((el) => {
			if (!el.classList.contains('jct-courses-grid')) {
				el.classList.add('jct-courses-grid');
			}
		});
	}

	function getPlaceholderUrl() { return chrome.runtime.getURL('assets/placeholder.svg'); }

	function relocateTopBlocksAfterCourses() {
		const body = document.body;
		if (!body || body.id !== 'page-site-index') return;
		const region = document.getElementById('region-main') || document.querySelector('#region-main, main');
		if (!region) return;
		const coursesGrid = region.querySelector('.jct-courses-grid');
		const coursesAnchor = coursesGrid ? (coursesGrid.closest('.block, .box, .card, section, .content, div') || coursesGrid) : null;
		if (!coursesAnchor) return;
		const candidates = new Set();
		region.querySelectorAll('.course-content .sitetopic').forEach((el) => candidates.add(el.closest('.card, .box, section, .content, div') || el));
		region.querySelectorAll('.box .simplesearchform, .simplesearchform').forEach((el) => candidates.add(el.closest('.box, .card, .content, form, div') || el));
		region.querySelectorAll('form.coursesearch, .coursesearchbox, [role="search"]').forEach((el) => candidates.add(el.closest('.card, .box, .content, form') || el));
		let hero = null; let maxArea = 0;
		region.querySelectorAll('img').forEach((img) => {
			const w = img.naturalWidth || img.width || 0;
			const h = img.naturalHeight || img.height || 0;
			const area = w * h;
			if (area > maxArea && (w >= 600 || h >= 180)) { hero = img; maxArea = area; }
		});
		if (hero) candidates.add(hero.closest('.card, .box, section, .content, div') || hero);
		Array.from(candidates).forEach((el) => {
			if (!el || el.classList.contains('jct-moved-bottom')) return;
			region.appendChild(el);
			el.classList.add('jct-moved-bottom');
		});
	}

	function hideFrontClutter() { /* no-op: keep banner/search visible per user request */ }

	docReady(async () => {
		document.documentElement.classList.add('jct-moodle-redesign');
		const html = document.documentElement;
		if (html.dir === 'rtl') html.classList.add('jct-rtl');
		await loadPaletteHeb();
		markCoursesContainers();
		ensureStructureAndColor();
		relocateTopBlocksAfterCourses();
		hideFrontClutter();
		const obs = new MutationObserver(() => { markCoursesContainers(); ensureStructureAndColor(); relocateTopBlocksAfterCourses(); hideFrontClutter(); });
		obs.observe(document.body, { childList: true, subtree: true });
		if (chrome?.storage?.onChanged) {
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area === 'sync' && changes.paletteByYearHeb) {
					paletteByYearHeb = changes.paletteByYearHeb.newValue;
					ensureStructureAndColor();
				}
			});
		}
	});
})();
