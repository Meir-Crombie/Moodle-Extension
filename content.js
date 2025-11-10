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
	let favoriteCourseIds = new Set();
	let courseSchedules = {};
	const processedCards = new WeakSet();
	let isReordering = false;
	let scheduled = false;
	let scheduleViewVisible = false;
	let saveSchedulesTimeout = null;
	let isSavingSchedules = false;

	function scheduleLightUpdate() {
		if (scheduled || isReordering) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			markCoursesContainers();
			ensureStructureAndColor();
			refreshFavoritesUI();
			// Don't update schedule view here - it causes event listeners to be lost
			// Only update if schedule is visible and we need to refresh
			if (scheduleViewVisible) {
				// Only update if container exists and is visible
				const container = document.getElementById('jct-weekly-schedule');
				if (container && container.style.display !== 'none') {
					// Use a debounced update to avoid constant refreshing
					clearTimeout(scheduleUpdateTimeout);
					scheduleUpdateTimeout = setTimeout(() => {
						updateWeeklyScheduleView();
					}, 500);
				}
			}
		});
	}
	
	let scheduleUpdateTimeout = null;

	function loadFavorites() {
		return new Promise((resolve) => {
			try {
				chrome.storage.sync.get({ favoriteCourseIds: [] }, (res) => {
					const arr = Array.isArray(res.favoriteCourseIds) ? res.favoriteCourseIds : [];
					favoriteCourseIds = new Set(arr.map(String));
					resolve(favoriteCourseIds);
				});
			} catch (_e) { resolve(favoriteCourseIds); }
		});
	}

	function loadCourseSchedules() {
		return new Promise((resolve) => {
			try {
				// Try local first, then sync
				chrome.storage.local.get({ courseSchedules: {}, scheduleViewVisible: false }, (res) => {
					if (chrome.runtime.lastError) {
						// Try sync as fallback
						chrome.storage.sync.get({ courseSchedules: {}, scheduleViewVisible: false }, (res2) => {
							if (chrome.runtime.lastError) {
								console.error('Error loading schedules:', chrome.runtime.lastError);
								resolve(courseSchedules);
								return;
							}
							courseSchedules = res2.courseSchedules || {};
							scheduleViewVisible = res2.scheduleViewVisible || false;
							const beforeMigration = JSON.stringify(courseSchedules);
							migrateSchedules();
							const afterMigration = JSON.stringify(courseSchedules);
							// Save if migration changed something
							if (beforeMigration !== afterMigration) {
								saveCourseSchedules();
							}
							resolve(courseSchedules);
						});
						return;
					}
					courseSchedules = res.courseSchedules || {};
					scheduleViewVisible = res.scheduleViewVisible || false;
					const beforeMigration = JSON.stringify(courseSchedules);
					migrateSchedules();
					const afterMigration = JSON.stringify(courseSchedules);
					// Save if migration changed something
					if (beforeMigration !== afterMigration) {
						saveCourseSchedules();
					}
					resolve(courseSchedules);
				});
			} catch (e) {
				console.error('Error in loadCourseSchedules:', e);
				resolve(courseSchedules);
			}
		});
	}
	
	function saveScheduleViewState() {
		try {
			chrome.storage.local.set({ scheduleViewVisible: scheduleViewVisible }, () => {
				if (chrome.runtime.lastError) {
					chrome.storage.sync.set({ scheduleViewVisible: scheduleViewVisible });
				}
			});
		} catch (e) {
			// Ignore
		}
	}
	
	function migrateSchedules() {
		// Migrate old format if needed and remove saturday
		Object.keys(courseSchedules).forEach(courseId => {
			if (Array.isArray(courseSchedules[courseId])) {
				// Old format: just array of days
				const days = courseSchedules[courseId];
				courseSchedules[courseId] = { days: days, name: `קורס ${courseId}` };
			}
			// Remove saturday from all courses
			if (courseSchedules[courseId].days) {
				courseSchedules[courseId].days = courseSchedules[courseId].days.filter(day => day !== 'saturday');
				// Remove course if no days left
				if (courseSchedules[courseId].days.length === 0) {
					delete courseSchedules[courseId];
				}
			}
		});
	}

	function saveFavorites() {
		try {
			chrome.storage.sync.set({ favoriteCourseIds: Array.from(favoriteCourseIds) });
		} catch (_e) { /* ignore */ }
	}

	function isFavorite(courseId) { return courseId && favoriteCourseIds.has(String(courseId)); }

	function toggleFavorite(courseId) {
		if (!courseId) return;
		const key = String(courseId);
		if (favoriteCourseIds.has(key)) favoriteCourseIds.delete(key); else favoriteCourseIds.add(key);
		saveFavorites();
		refreshFavoritesUI();
	}

	function getCourseIdFromCard(card) {
		let mainLink = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
		if (mainLink && mainLink.href) {
			const m = mainLink.href.match(/[?&]id=(\d+)/);
			if (m) return m[1];
		}
		const idFromAttr = card.getAttribute('data-course-id') || card.dataset.courseId;
		if (idFromAttr) return String(idFromAttr);
		return null;
	}

	function getCourseNameFromCard(card) {
		const nameEl = card.querySelector('.coursename a, .course-title a, .list-group-item a.course-title, .list-group-item .coursename a');
		if (nameEl) {
			return nameEl.textContent.trim() || nameEl.innerText.trim();
		}
		return card.textContent.trim().split('\n')[0] || 'קורס ללא שם';
	}

	function refreshFavoritesUI() {
		// Update star icons and reorder containers
		isReordering = true;
		try { document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites); }
		finally { isReordering = false; }
		document.querySelectorAll('.jct-fav-toggle').forEach((btn) => {
			const card = btn.closest('.list-group-item, .coursebox, .card.course, li, .dashboard-card');
			const cid = card ? getCourseIdFromCard(card) : null;
			btn.classList.toggle('jct-fav-on', isFavorite(cid));
			btn.setAttribute('aria-pressed', isFavorite(cid) ? 'true' : 'false');
			btn.textContent = isFavorite(cid) ? '★' : '☆';
			if (card) card.setAttribute('data-jct-fav', isFavorite(cid) ? '1' : '0');
		});
	}

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

	const CARD_STYLE_SELECTOR = '.list-group-item, .coursebox, .card.course, .course-list > li';

	function getStyledCardEl(card) {
		if (!card) return null;
		if (card.matches && card.matches(CARD_STYLE_SELECTOR)) return card;
		return card.querySelector(CARD_STYLE_SELECTOR) || card;
	}

	function ensureStructureAndColor() {
		const cards = document.querySelectorAll('.jct-courses-grid > .list-group-item, .jct-courses-grid .list-group > .list-group-item, .jct-courses-grid .coursebox, .jct-courses-grid .card.course, .jct-courses-grid .course-list > li, .jct-courses-grid > .dashboard-card');
		cards.forEach((card) => {
			// Ensure base positioning for overlays
			if (!card.style.position) card.style.position = 'relative';

			const already = processedCards.has(card);
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
			// Always recompute color so palette or detected text changes reflect immediately
			const text = card.innerText || card.textContent || '';
			let { year, semIdx } = parseHebrewYearAndSemester(text);
			if (year == null || semIdx == null) {
				// Fallback: derive stable indices from course id so colors vary and use options palette
				const cid = getCourseIdFromCard(card) || '';
				let hash = 0; for (let i = 0; i < cid.length; i++) { hash = ((hash << 5) - hash) + cid.charCodeAt(i); hash |= 0; }
				const row = Math.abs(hash) % HEBREW_YEARS.length;
				year = HEBREW_YEARS[row];
				const sems = [0,1,2];
				semIdx = sems[Math.abs(hash >> 3) % sems.length];
			}
			const { h, s, l } = colorFor(year, semIdx);
			const styledEl = getStyledCardEl(card);
			styledEl.style.setProperty('--jct-accent-h', String(h));
			styledEl.style.setProperty('--jct-accent-s', String(s) + '%');
			styledEl.style.setProperty('--jct-accent-l', String(l) + '%');
			// Favorite toggle
			let favBtn = card.querySelector('.jct-fav-toggle');
			const courseId = getCourseIdFromCard(card);
			if (!favBtn) {
				favBtn = document.createElement('button');
				favBtn.type = 'button';
				favBtn.className = 'jct-fav-toggle';
				favBtn.title = 'Toggle favorite';
				favBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					const cid = getCourseIdFromCard(card);
					toggleFavorite(cid);
				});
				card.appendChild(favBtn);
			}
			card.setAttribute('data-jct-fav', isFavorite(courseId) ? '1' : '0');
			favBtn.classList.toggle('jct-fav-on', isFavorite(courseId));
			favBtn.setAttribute('aria-pressed', isFavorite(courseId) ? 'true' : 'false');
			favBtn.textContent = isFavorite(courseId) ? '★' : '☆';

			// Schedule button
			let scheduleBtn = card.querySelector('.jct-schedule-btn');
			if (!scheduleBtn) {
				scheduleBtn = document.createElement('button');
				scheduleBtn.type = 'button';
				scheduleBtn.className = 'jct-schedule-btn';
				scheduleBtn.title = 'הוסף ללוח זמנים (לחץ לעריכה, גרור להוספה)';
				scheduleBtn.textContent = '📅';
				scheduleBtn.setAttribute('draggable', 'true');
				scheduleBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					showScheduleDayPicker(courseId, card);
				});
				scheduleBtn.addEventListener('dragstart', (e) => {
					e.stopPropagation();
					const courseName = getCourseNameFromCard(card);
					const courseUrlEl = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
					const courseUrl = courseUrlEl ? courseUrlEl.href : '#';
					const data = {
						courseId: courseId,
						courseName: courseName,
						courseUrl: courseUrl
					};
					e.dataTransfer.setData('text/plain', JSON.stringify(data));
					e.dataTransfer.effectAllowed = 'move';
					card.style.opacity = '0.5';
					// Scroll to schedule when starting to drag
					const scheduleContainer = document.getElementById('jct-weekly-schedule');
					if (scheduleContainer) {
						// Make sure schedule is visible
						if (!scheduleViewVisible) {
							scheduleViewVisible = true;
							scheduleContainer.style.display = 'block';
							const toggleBtn = document.getElementById('jct-schedule-toggle');
							if (toggleBtn) {
								toggleBtn.textContent = '✕ סגור לוח זמנים';
							}
							saveScheduleViewState();
						}
						setTimeout(() => {
							scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
						}, 100);
					}
				});
				scheduleBtn.addEventListener('dragend', (e) => {
					card.style.opacity = '1';
				});
				card.appendChild(scheduleBtn);
			}
			
			// Make the card draggable when dragging from schedule button
			// The schedule button itself is draggable, so we don't need to make the whole card draggable
			if (!card.hasAttribute('data-jct-idx')) {
				const parent = card.parentElement;
				if (parent) {
					const idx = Array.prototype.indexOf.call(parent.children, card);
					card.setAttribute('data-jct-idx', String(idx));
				}
			}

			// Clickable logic preserved...
			let mainLink = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a');
			if (mainLink && !card.classList.contains('jct-clickable')) {
				card.classList.add('jct-clickable');
				card.style.cursor = 'pointer';
				let isDragging = false;
				let dragStartX = 0;
				let dragStartY = 0;
				
				card.addEventListener('mousedown', (e) => {
					if (e.target.closest('.jct-fav-toggle') || e.target.closest('.jct-schedule-btn')) return;
					dragStartX = e.clientX;
					dragStartY = e.clientY;
					isDragging = false;
				});
				
				card.addEventListener('mousemove', (e) => {
					if (Math.abs(e.clientX - dragStartX) > 5 || Math.abs(e.clientY - dragStartY) > 5) {
						isDragging = true;
					}
				});
				
				card.addEventListener('click', (event) => {
					if (event.target.closest('.jct-fav-toggle')) return;
					if (event.target.closest('.jct-schedule-btn')) return;
					if (event.target.closest('a[href*="/course/view.php"]')) return;
					if (isDragging) {
						isDragging = false;
						return;
					}
					window.open(mainLink.href, '_self');
				});
			}
			processedCards.add(card);
		});
		// colums amount
		chrome.storage.sync.get({ columnCount: 3 }, ({ columnCount }) => {
		document.documentElement.style.setProperty('--jct-columns', columnCount);
});


		// After ensuring cards, reorder each grid container in a guarded way
		isReordering = true;
		try { document.querySelectorAll('.jct-courses-grid').forEach(reorderContainerByFavorites); }
		finally { isReordering = false; }
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

	function reorderContainerByFavorites(container) {
		if (!container) return;
		const children = Array.from(container.children);
		// Determine favorites and keep stable order by original index
		const withMeta = children.map((el, i) => {
			const card = el;
			const idx = Number(card.getAttribute('data-jct-idx') || i);
			const cid = getCourseIdFromCard(card) || getCourseIdFromCard(card.querySelector('.list-group-item, .coursebox, .card.course, li') || card);
			const fav = isFavorite(cid) || card.getAttribute('data-jct-fav') === '1';
			return { card, fav, idx };
		});
		const sorted = withMeta.slice().sort((a, b) => {
			if (a.fav !== b.fav) return a.fav ? -1 : 1;
			return a.idx - b.idx;
		});
		let changed = false;
		sorted.forEach(({ card }, pos) => {
			if (container.children[pos] !== card) { changed = true; container.appendChild(card); }
		});
		if (changed) {
			// Update indices
			Array.from(container.children).forEach((c, i) => c.setAttribute('data-jct-idx', String(i)));
		}
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

	const DAYS_OF_WEEK = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
	const DAYS_OF_WEEK_EN = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

	function showScheduleDayPicker(courseId, card) {
		const courseName = getCourseNameFromCard(card);
		const courseUrl = card.querySelector('a[href*="/course/view.php"], .coursename a, .course-title a')?.href || '#';
		const currentSchedule = courseSchedules[courseId] || { name: courseName, days: [] };
		
		// Create modal
		const modal = document.createElement('div');
		modal.className = 'jct-schedule-modal';
		modal.innerHTML = `
			<div class="jct-schedule-modal-content">
				<div class="jct-schedule-modal-header">
					<h3>בחר ימים עבור: ${courseName}</h3>
					<button class="jct-schedule-modal-close">✕</button>
				</div>
				<div class="jct-schedule-modal-body">
					${DAYS_OF_WEEK.map((day, idx) => {
						const dayKey = DAYS_OF_WEEK_EN[idx];
						const checked = currentSchedule.days.includes(dayKey) ? 'checked' : '';
						return `<label class="jct-schedule-day-checkbox">
							<input type="checkbox" data-day="${dayKey}" ${checked}>
							<span>${day}</span>
						</label>`;
					}).join('')}
				</div>
				<div class="jct-schedule-modal-footer">
					<button class="jct-schedule-modal-save">שמור</button>
					<button class="jct-schedule-modal-remove">הסר מלוח זמנים</button>
					<button class="jct-schedule-modal-delete-all">מחק לחלוטין</button>
				</div>
			</div>
		`;
		
		document.body.appendChild(modal);
		
		// Event listeners
		modal.querySelector('.jct-schedule-modal-close').addEventListener('click', () => {
			modal.remove();
		});
		
		modal.querySelector('.jct-schedule-modal-save').addEventListener('click', async () => {
			const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
			const selectedDays = Array.from(checkboxes)
				.filter(cb => cb.checked)
				.map(cb => cb.getAttribute('data-day'));
			
			if (selectedDays.length > 0) {
				courseSchedules[courseId] = { name: courseName, days: selectedDays, url: courseUrl };
			} else {
				delete courseSchedules[courseId];
			}
			
			try {
				await saveCourseSchedules();
				setTimeout(() => {
					updateWeeklyScheduleView();
					modal.remove();
				}, 300);
			} catch (err) {
				console.error('Error saving course schedule:', err);
				alert('שגיאה בשמירת הלוח זמנים. נסה שוב.');
				modal.remove();
			}
		});
		
		modal.querySelector('.jct-schedule-modal-remove').addEventListener('click', async () => {
			delete courseSchedules[courseId];
			try {
				await saveCourseSchedules();
				setTimeout(() => {
					updateWeeklyScheduleView();
					modal.remove();
				}, 300);
			} catch (err) {
				console.error('Error removing course:', err);
				modal.remove();
			}
		});
		
		const deleteAllBtn = modal.querySelector('.jct-schedule-modal-delete-all');
		if (deleteAllBtn) {
			deleteAllBtn.addEventListener('click', async () => {
				if (confirm('האם אתה בטוח שברצונך למחוק את הקורס לחלוטין מכל הימים?')) {
					delete courseSchedules[courseId];
					try {
						await saveCourseSchedules();
						setTimeout(() => {
							updateWeeklyScheduleView();
							modal.remove();
						}, 300);
					} catch (err) {
						console.error('Error deleting course:', err);
						modal.remove();
					}
				}
			});
		}
		
		modal.addEventListener('click', (e) => {
			if (e.target === modal) modal.remove();
		});
	}

	function saveCourseSchedules() {
		return new Promise((resolve) => {
			// Clear any pending saves
			if (saveSchedulesTimeout) {
				clearTimeout(saveSchedulesTimeout);
			}
			
			// If already saving, wait a bit
			if (isSavingSchedules) {
				saveSchedulesTimeout = setTimeout(() => {
					saveCourseSchedules().then(resolve);
				}, 200);
				return;
			}
			
			isSavingSchedules = true;
			
			try {
				const schedulesToSave = JSON.parse(JSON.stringify(courseSchedules));
				chrome.storage.local.set({ courseSchedules: schedulesToSave }, () => {
					isSavingSchedules = false;
					if (chrome.runtime.lastError) {
						console.error('Error saving schedules:', chrome.runtime.lastError);
						// Try sync as fallback
						try {
							chrome.storage.sync.set({ courseSchedules: schedulesToSave }, () => {
								resolve();
							});
						} catch (e) {
							resolve();
						}
					} else {
						resolve();
					}
				});
			} catch (e) {
				console.error('Error in saveCourseSchedules:', e);
				isSavingSchedules = false;
				resolve();
			}
		});
	}

	function createWeeklyScheduleView() {
		// Check if schedule view already exists
		let scheduleContainer = document.getElementById('jct-weekly-schedule');
		if (scheduleContainer) {
			updateWeeklyScheduleView();
			return scheduleContainer;
		}

		const region = document.getElementById('region-main') || document.querySelector('#region-main, main');
		if (!region) return null;

		// Create toggle button
		const toggleBtn = document.createElement('button');
		toggleBtn.id = 'jct-schedule-toggle';
		toggleBtn.className = 'jct-schedule-toggle';
		toggleBtn.textContent = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 הצג לוח זמנים שבועי';
		toggleBtn.addEventListener('click', () => {
			scheduleViewVisible = !scheduleViewVisible;
			const container = document.getElementById('jct-weekly-schedule');
			if (container) {
				container.style.display = scheduleViewVisible ? 'block' : 'none';
				toggleBtn.textContent = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 הצג לוח זמנים שבועי';
				saveScheduleViewState();
				// Scroll to schedule if opening
				if (scheduleViewVisible) {
					setTimeout(() => {
						container.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}, 100);
				}
			}
		});

		// Create schedule container
		scheduleContainer = document.createElement('div');
		scheduleContainer.id = 'jct-weekly-schedule';
		scheduleContainer.className = 'jct-weekly-schedule';
		scheduleContainer.style.display = scheduleViewVisible ? 'block' : 'none';

		// Insert before courses grid
		const coursesGrid = region.querySelector('.jct-courses-grid');
		if (coursesGrid && coursesGrid.parentElement) {
			coursesGrid.parentElement.insertBefore(toggleBtn, coursesGrid);
			coursesGrid.parentElement.insertBefore(scheduleContainer, coursesGrid);
		} else {
			region.insertBefore(toggleBtn, region.firstChild);
			region.insertBefore(scheduleContainer, region.firstChild);
		}

		updateWeeklyScheduleView();
		return scheduleContainer;
	}

	function updateWeeklyScheduleView() {
		const scheduleContainer = document.getElementById('jct-weekly-schedule');
		if (!scheduleContainer) {
			console.log('Schedule container not found, creating it...');
			createWeeklyScheduleView();
			return;
		}

		// Group courses by day from courseSchedules
		const coursesByDay = {};
		DAYS_OF_WEEK_EN.forEach(day => { coursesByDay[day] = []; });

		Object.keys(courseSchedules).forEach(courseId => {
			const schedule = courseSchedules[courseId];
			if (!schedule || !schedule.days || schedule.days.length === 0) return;

			schedule.days.forEach(day => {
				if (coursesByDay[day]) {
					coursesByDay[day].push({
						id: courseId,
						name: schedule.name || `קורס ${courseId}`,
						url: schedule.url || '#'
					});
				}
			});
		});

		// Build HTML
		let html = '<div class="jct-schedule-header"><h2>לוח זמנים שבועי</h2><p class="jct-schedule-hint">גרור 📅 לימים או לחץ עליו לעריכה  </p>';
		html += '<button class="jct-schedule-delete-all-btn" title="מחק את כל הקורסים מהלוח זמנים">🗑️ מחק הכל</button></div>';
		html += '<div class="jct-schedule-grid">';
		
		DAYS_OF_WEEK.forEach((dayName, idx) => {
			const dayKey = DAYS_OF_WEEK_EN[idx];
			const courses = coursesByDay[dayKey] || [];
			
			html += `<div class="jct-schedule-day" data-day="${dayKey}">
				<div class="jct-schedule-day-header">${dayName}</div>
				<div class="jct-schedule-day-courses" data-day="${dayKey}">`;
			
			if (courses.length === 0) {
				html += '<div class="jct-schedule-empty">גרור קורס לכאן</div>';
			} else {
				courses.forEach(course => {
					html += `<div class="jct-schedule-course-item" data-course-id="${course.id}" draggable="true">
						<a href="${course.url}" class="jct-schedule-course-link">${course.name}</a>
						<button class="jct-schedule-remove-course" data-course-id="${course.id}" data-day="${dayKey}" title="הסר מיום זה">✕</button>
					</div>`;
				});
			}
			
			html += '</div></div>';
		});
		
		html += '</div>';
		scheduleContainer.innerHTML = html;
		
		// Setup delete all button - use event delegation on document to ensure it always works
		// Remove old listener if exists
		if (scheduleContainer._deleteAllHandler) {
			document.removeEventListener('click', scheduleContainer._deleteAllHandler);
		}
		
		// Create new handler
		scheduleContainer._deleteAllHandler = async (e) => {
			const deleteBtn = e.target.closest('.jct-schedule-delete-all-btn');
			if (deleteBtn) {
				e.preventDefault();
				e.stopPropagation();
				console.log('Delete all button clicked');
				const hasCourses = Object.keys(courseSchedules).length > 0;
				if (!hasCourses) {
					alert('אין קורסים במערכת למחיקה');
					return;
				}
				
				if (confirm('⚠️ האם אתה בטוח שברצונך למחוק את כל הקורסים מהלוח זמנים?\n\nפעולה זו לא ניתנת לביטול!')) {
					if (confirm('האם אתה בטוח לחלוטין? כל הקורסים יימחקו מהלוח זמנים.')) {
						courseSchedules = {};
						try {
							await saveCourseSchedules();
							// Use setTimeout to avoid race conditions
							setTimeout(() => {
								updateWeeklyScheduleView();
								alert('כל הקורסים נמחקו מהלוח זמנים');
							}, 300);
						} catch (err) {
							console.error('Error deleting all courses:', err);
							alert('שגיאה במחיקת הקורסים. נסה שוב.');
						}
					}
				}
			}
		};
		
		// Use event delegation on document - this way it always works even if HTML is replaced
		document.addEventListener('click', scheduleContainer._deleteAllHandler);

		// Setup drag and drop
		setupScheduleDragAndDrop();
		
		// Make sure the container visibility matches saved state
		const toggleBtn = document.getElementById('jct-schedule-toggle');
		if (toggleBtn) {
			scheduleContainer.style.display = scheduleViewVisible ? 'block' : 'none';
			toggleBtn.textContent = scheduleViewVisible ? '✕ סגור לוח זמנים' : '📅 הצג לוח זמנים שבועי';
		}
	}

	function setupScheduleDragAndDrop() {
		// Remove old listeners by using a unique class or data attribute
		const dayColumns = document.querySelectorAll('.jct-schedule-day-courses');
		
		// Remove all old event listeners by cloning
		dayColumns.forEach(column => {
			// Clone to remove old listeners
			const newColumn = column.cloneNode(true);
			column.parentNode.replaceChild(newColumn, column);
		});
		
		// Now setup new listeners
		const newDayColumns = document.querySelectorAll('.jct-schedule-day-courses');
		newDayColumns.forEach(column => {
			// Allow dropping
			column.addEventListener('dragenter', (e) => {
				e.preventDefault();
				column.classList.add('jct-schedule-drag-over');
				// Scroll to top when dragging over
				const scheduleContainer = document.getElementById('jct-weekly-schedule');
				if (scheduleContainer) {
					scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
			});
			
			column.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.dataTransfer.dropEffect = 'move';
				column.classList.add('jct-schedule-drag-over');
			});
			
			column.addEventListener('dragleave', (e) => {
				// Only remove if we're actually leaving the column
				if (!column.contains(e.relatedTarget)) {
					column.classList.remove('jct-schedule-drag-over');
				}
			});
			
				column.addEventListener('drop', async (e) => {
				e.preventDefault();
				e.stopPropagation();
				column.classList.remove('jct-schedule-drag-over');
				
				try {
					const dataStr = e.dataTransfer.getData('text/plain');
					if (!dataStr || dataStr === 'null') {
						console.log('No data in drop event');
						return;
					}
					
					const data = JSON.parse(dataStr);
					const dayKey = column.getAttribute('data-day');
					
					if (data.courseId && dayKey) {
						// If moving from schedule, remove from old day first
						if (data.fromSchedule) {
							const oldItem = document.querySelector(`.jct-schedule-course-item[data-course-id="${data.courseId}"]`);
							if (oldItem) {
								const oldDayKey = oldItem.closest('.jct-schedule-day-courses')?.getAttribute('data-day');
								if (oldDayKey && oldDayKey !== dayKey && courseSchedules[data.courseId]) {
									courseSchedules[data.courseId].days = courseSchedules[data.courseId].days.filter(d => d !== oldDayKey);
								}
							}
						}
						
						// Add course to this day
						if (!courseSchedules[data.courseId]) {
							courseSchedules[data.courseId] = {
								name: data.courseName || `קורס ${data.courseId}`,
								days: [],
								url: data.courseUrl || '#'
							};
						}
						
						if (!courseSchedules[data.courseId].days.includes(dayKey)) {
							courseSchedules[data.courseId].days.push(dayKey);
							try {
								await saveCourseSchedules();
								setTimeout(() => updateWeeklyScheduleView(), 300);
							} catch (err) {
								console.error('Error adding course to day:', err);
							}
						}
					}
				} catch (err) {
					console.error('Error handling drop:', err, e.dataTransfer.getData('text/plain'));
				}
			});
		});

		// Make course items in schedule draggable - use event delegation for click handlers
		// Setup click handler on document for course items
		if (!document._scheduleCourseClickHandler) {
			document._scheduleCourseClickHandler = (e) => {
				const courseItem = e.target.closest('.jct-schedule-course-item');
				if (!courseItem) return;
				
				// Don't navigate if clicking on remove button
				if (e.target.closest('.jct-schedule-remove-course')) {
					return;
				}
				
				const link = courseItem.querySelector('a.jct-schedule-course-link');
				if (link && link.href && link.href !== '#') {
					// Don't navigate if item is semi-transparent (being dragged)
					if (courseItem.style.opacity === '0.5') {
						return;
					}
					// Navigate to course
					e.preventDefault();
					e.stopPropagation();
					window.location.href = link.href;
				}
			};
			document.addEventListener('click', document._scheduleCourseClickHandler, true);
		}
		
		// Make course items draggable
		const courseItems = document.querySelectorAll('.jct-schedule-course-item');
		courseItems.forEach(item => {
			item.addEventListener('dragstart', (e) => {
				// Don't drag if clicking on remove button
				if (e.target.closest('.jct-schedule-remove-course')) {
					e.preventDefault();
					return;
				}
				// Don't drag if clicking directly on link
				if (e.target.tagName === 'A' || e.target.closest('a')) {
					e.preventDefault();
					return;
				}
				const courseId = item.getAttribute('data-course-id');
				const course = courseSchedules[courseId];
				if (course) {
					e.dataTransfer.setData('text/plain', JSON.stringify({
						courseId: courseId,
						courseName: course.name,
						courseUrl: course.url,
						fromSchedule: true
					}));
					e.dataTransfer.effectAllowed = 'move';
					item.style.opacity = '0.5';
					// Scroll to top when starting to drag
					const scheduleContainer = document.getElementById('jct-weekly-schedule');
					if (scheduleContainer) {
						scheduleContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
					}
				}
			});
			
			item.addEventListener('dragend', (e) => {
				item.style.opacity = '1';
			});

			// Remove button - remove from specific day
			const removeBtn = item.querySelector('.jct-schedule-remove-course');
			if (removeBtn) {
				// Get dayKey from button's data attribute or parent
				const dayKey = removeBtn.getAttribute('data-day') || item.closest('.jct-schedule-day-courses')?.getAttribute('data-day');
				if (dayKey) {
					removeBtn.setAttribute('data-day', dayKey);
				}
				
				removeBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					e.preventDefault();
					const courseId = removeBtn.getAttribute('data-course-id');
					const dayKeyFromBtn = removeBtn.getAttribute('data-day') || item.closest('.jct-schedule-day-courses')?.getAttribute('data-day');
					
					if (courseId && dayKeyFromBtn && courseSchedules[courseId]) {
						courseSchedules[courseId].days = courseSchedules[courseId].days.filter(d => d !== dayKeyFromBtn);
						if (courseSchedules[courseId].days.length === 0) {
							delete courseSchedules[courseId];
						}
						try {
							await saveCourseSchedules();
							setTimeout(() => updateWeeklyScheduleView(), 300);
						} catch (err) {
							console.error('Error removing course:', err);
						}
					}
				});
			}
			
			// Style item as clickable - click handling is done via event delegation above
			const link = item.querySelector('a.jct-schedule-course-link');
			if (link && link.href && link.href !== '#') {
				item.style.cursor = 'pointer';
				link.style.cursor = 'pointer';
			}
		});
		
		// The drop handler above already handles both new courses and moving between days
	}

	function hideFrontClutter() {
		// Remove the empty box div
		const emptyBox = document.querySelector('.box.py-3.d-flex.justify-content-center');
		if (emptyBox && emptyBox.children.length === 0) {
			emptyBox.remove();
		}
		// Also try with just the classes
		document.querySelectorAll('.box.py-3').forEach(box => {
			if (box.classList.contains('d-flex') && box.classList.contains('justify-content-center') && box.children.length === 0) {
				box.remove();
			}
		});
	}

	docReady(async () => {
		document.documentElement.classList.add('jct-moodle-redesign');
		const html = document.documentElement;
		if (html.dir === 'rtl') html.classList.add('jct-rtl');
		await Promise.all([loadPaletteHeb(), loadFavorites(), loadCourseSchedules()]);
		markCoursesContainers();
		ensureStructureAndColor();
		relocateTopBlocksAfterCourses();
		hideFrontClutter();
		createWeeklyScheduleView();
	const obs = new MutationObserver(() => { scheduleLightUpdate(); });
		obs.observe(document.body, { childList: true, subtree: true });
		if (chrome?.storage?.onChanged) {
			chrome.storage.onChanged.addListener((changes, area) => {
				if (area === 'sync' && changes.paletteByYearHeb) {
					paletteByYearHeb = changes.paletteByYearHeb.newValue;
					ensureStructureAndColor();
				}
				if (area === 'sync' && changes.favoriteCourseIds) {
					const arr = Array.isArray(changes.favoriteCourseIds.newValue) ? changes.favoriteCourseIds.newValue : [];
					favoriteCourseIds = new Set(arr.map(String));
					refreshFavoritesUI();
				}
				if (area === 'sync' && changes.courseSchedules) {
					courseSchedules = changes.courseSchedules.newValue || {};
					updateWeeklyScheduleView();
				}
			});
		}
	});
})();
