/**
 * ==========================================================================
 * كريم محمود - بورتفوليو احترافي
 * محرك التخزين الفائق التراكمي والدائم (IndexedDB + Persistent Cache)
 * ==========================================================================
 */

(function () {
  'use strict';

  /* --------------------------------------------------------------------------
     1. إعداد قاعدة بيانات المتصفح IndexedDB (حفظ دائم وغير محدود)
     -------------------------------------------------------------------------- */
  const DB_NAME = 'KarimPortfolioDB_v2';
  const DB_VERSION = 1;
  const STORE_PROJECTS = 'projects';
  const STORE_SETTINGS = 'settings';

  // مفاتيح التخزين
  const STORAGE_THEME = 'km_portfolio_theme';
  const STORAGE_CACHE_INDEX = 'km_portfolio_projects_cache_v2';
  const SETTING_PHOTO = 'avatar_image_blob';
  const SETTING_BRAND_LOGO = 'brand_logo_image_blob';

  let dbInstance = null;
  let dbPromise = null;

  function openDatabase() {
    if (dbInstance) {
      return Promise.resolve(dbInstance);
    }
    if (dbPromise) {
      return dbPromise;
    }

    if (!('indexedDB' in window)) {
      console.warn('المتصفح لا يدعم IndexedDB، سيتم استخدام التخزين المحلي كبديل.');
      return Promise.resolve(null);
    }

    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = function (event) {
          const db = event.target.result;

          if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
            const projectStore = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
            projectStore.createIndex('type', 'type', { unique: false });
            projectStore.createIndex('createdAt', 'createdAt', { unique: false });
          }

          if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
            db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
          }
        };

        request.onsuccess = function (event) {
          dbInstance = event.target.result;
          resolve(dbInstance);
        };

        request.onerror = function (event) {
          console.error('فشل فتح IndexedDB:', event.target.error);
          dbPromise = null;
          resolve(null); // السماح بالعمل عبر الكاش الاحتياطي
        };

        request.onblocked = function () {
          console.warn('فتح IndexedDB معلق بسبب نافذة أخرى');
          dbPromise = null;
          resolve(null);
        };
      } catch (e) {
        console.error('خطأ في إعداد IndexedDB:', e);
        resolve(null);
      }
    });

    return dbPromise;
  }

  // فحص واستيراد أي مشاريع مخزنة في قواعد بيانات أو كاش سابقة تلقائياً
  async function checkAndMigrateLegacyDB() {
    if (!('indexedDB' in window)) return [];
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('KarimPortfolioDB', 1);
        req.onsuccess = (e) => {
          const legacyDb = e.target.result;
          if (!legacyDb.objectStoreNames.contains('projects')) {
            legacyDb.close();
            resolve([]);
            return;
          }
          try {
            const tx = legacyDb.transaction('projects', 'readonly');
            const store = tx.objectStore('projects');
            const getReq = store.getAll();
            getReq.onsuccess = () => {
              const res = getReq.result || [];
              legacyDb.close();
              resolve(res);
            };
            getReq.onerror = () => { legacyDb.close(); resolve([]); };
          } catch (err) {
            legacyDb.close();
            resolve([]);
          }
        };
        req.onerror = () => resolve([]);
      } catch (e) {
        resolve([]);
      }
    });
  }

  // قراءة كافة المشاريع المخزنة في IndexedDB مع الدمج الشامل للكاش المحلي لمنع ضياع أي ملف بتاتاً
  async function dbGetAllProjects() {
    let dbProjects = [];
    try {
      const db = await openDatabase();
      if (db) {
        dbProjects = await new Promise((resolve) => {
          try {
            const tx = db.transaction(STORE_PROJECTS, 'readonly');
            const store = tx.objectStore(STORE_PROJECTS);
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch (e) {
            resolve([]);
          }
        });
      }
    } catch (e) {
      dbProjects = [];
    }

    // استرداد أي مشاريع من الإصدار السابق من قاعدة البيانات
    let legacyProjects = [];
    try {
      legacyProjects = await checkAndMigrateLegacyDB();
    } catch (e) {}

    // استرداد المشاريع من الكاش المحلي المزدوج
    const localProjects = getLocalProjectsCache();

    // دمج ذكي بدون تكرار (المشاريع ذات الـ Blob الكامل في IndexedDB لها الأولوية)
    const mergedMap = new Map();
    const isUserUploaded = (p) => p && p.id && !p.isDefault && !(typeof p.id === 'string' && (p.id.startsWith('def-') || p.id.startsWith('dummy-')));

    for (const p of legacyProjects) {
      if (isUserUploaded(p)) mergedMap.set(p.id, p);
    }

    for (const p of localProjects) {
      if (isUserUploaded(p)) mergedMap.set(p.id, p);
    }

    for (const p of dbProjects) {
      if (isUserUploaded(p)) {
        mergedMap.set(p.id, p);
      }
    }

    const allUserProjects = Array.from(mergedMap.values());

    // مزامنة عكسية سريعة لحفظ كل ما هو بالكاش داخل IndexedDB تلقائياً
    if (allUserProjects.length > dbProjects.length) {
      try {
        dbSaveBatchProjects(allUserProjects);
      } catch (e) {}
    }

    return allUserProjects;
  }

  // حفظ مشروع فردي في IndexedDB والكاش الاحتياطي مع التأكيد الكامل على القرص
  async function dbSaveProject(project) {
    // 1. التحديث الفوري المباشر للكاش المحلي ليظل متوفراً في كل الظروف
    updateLocalProjectCache(project);

    // 2. الحفظ الفعلي الدائم في IndexedDB
    try {
      const db = await openDatabase();
      if (db) {
        await new Promise((resolve, reject) => {
          try {
            const tx = db.transaction(STORE_PROJECTS, 'readwrite');
            const store = tx.objectStore(STORE_PROJECTS);
            store.put(project);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
          } catch (e) {
            reject(e);
          }
        });
      }
    } catch (dbErr) {
      console.warn('تم حفظ المشروع في الكاش المحلي المتزامن:', dbErr);
    }

    // طلب التخزين الدائم غير القابل للمسح
    requestPersistentStorage();
  }

  // حفظ دفعة مشاريع في معاملة واحدة سريعة
  async function dbSaveBatchProjects(projectsArray) {
    const db = await openDatabase();
    if (db) {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_PROJECTS, 'readwrite');
          const store = tx.objectStore(STORE_PROJECTS);

          for (const p of projectsArray) {
            store.put(p);
          }

          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      });
    }

    // تحديث الكاش المحلي المتزامن
    for (const p of projectsArray) {
      updateLocalProjectCache(p);
    }
  }

  // حذف مشروع من IndexedDB والكاش
  async function dbDeleteProject(id) {
    const db = await openDatabase();
    if (db) {
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_PROJECTS, 'readwrite');
          const store = tx.objectStore(STORE_PROJECTS);
          const req = store.delete(id);
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    }

    removeLocalProjectCache(id);
  }

  // إدارة الإعدادات والصورة الشخصية
  async function dbSaveSetting(key, value) {
    const db = await openDatabase();
    if (db) {
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_SETTINGS, 'readwrite');
          const store = tx.objectStore(STORE_SETTINGS);
          const req = store.put({ key, value });
          req.onsuccess = () => resolve(true);
          req.onerror = () => resolve(false);
        } catch (e) {
          resolve(false);
        }
      });
    }
  }

  async function dbGetSetting(key) {
    const db = await openDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_SETTINGS, 'readonly');
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /* --------------------------------------------------------------------------
     2. الكاش الاحتياطي المزدوج في LocalStorage للتحميل الفوري
     -------------------------------------------------------------------------- */
  function getLocalProjectsCache() {
    try {
      const v2Data = localStorage.getItem(STORAGE_CACHE_INDEX);
      const v1Data = localStorage.getItem('km_portfolio_projects_cache');
      let v2List = v2Data ? JSON.parse(v2Data) : [];
      let v1List = v1Data ? JSON.parse(v1Data) : [];
      const map = new Map();
      const isValid = (p) => p && p.id && !p.isDefault && !(typeof p.id === 'string' && (p.id.startsWith('def-') || p.id.startsWith('dummy-'))) && !isCartoonItem(p) && !(p.type === 'video' && !p.id.startsWith('yt-vid-'));
      for (const p of v2List) {
        if (isValid(p)) map.set(p.id, p);
      }
      for (const p of v1List) {
        if (isValid(p) && !map.has(p.id)) map.set(p.id, p);
      }
      return Array.from(map.values());
    } catch (e) {
      return [];
    }
  }

  function updateLocalProjectCache(project) {
    try {
      let list = getLocalProjectsCache();
      const idx = list.findIndex((p) => p.id === project.id);

      const safeImages = Array.isArray(project.images) ? project.images.map((img, i) => ({
        id: img.id || 'img_' + i,
        name: img.name || '',
        thumbUrl: img.thumbUrl || null,
        media: typeof img.media === 'string' ? img.media : null
      })) : null;

      const safeVideos = Array.isArray(project.videos) ? project.videos.map((vid, i) => ({
        id: vid.id || 'vid_' + i,
        title: vid.title || '',
        name: vid.name || '',
        thumbUrl: vid.thumbUrl || null,
        videoUrl: vid.videoUrl || null,
        youtubeId: vid.youtubeId || null,
        desc: vid.desc || '',
        media: typeof vid.media === 'string' ? vid.media : null
      })) : null;

      const safeAudios = Array.isArray(project.audios) ? project.audios.map((aud, i) => ({
        id: aud.id || 'aud_' + i,
        title: aud.title || '',
        name: aud.name || '',
        thumbUrl: aud.thumbUrl || null,
        audioDuration: aud.audioDuration || '01:00',
        audioUrl: aud.audioUrl || null
      })) : null;

      // تجريد الـ Blob من كاش LocalStorage لتجنب تجاوز الحجم وتخزين الرابط والمعاينة فقط
      const safeProject = {
        id: project.id,
        type: project.type,
        title: project.title,
        category: project.category,
        desc: project.desc,
        thumbUrl: project.thumbUrl || null,
        media: typeof project.media === 'string' ? project.media : null,
        videoUrl: project.videoUrl,
        youtubeId: project.youtubeId,
        aspectRatio: project.aspectRatio,
        audioUrl: project.audioUrl || null,
        audioDuration: project.audioDuration || null,
        isCartoon: !!project.isCartoon,
        isAlbum: !!project.isAlbum || (safeImages && safeImages.length > 1) || (safeVideos && safeVideos.length > 1) || (safeAudios && safeAudios.length > 1),
        coverIndex: typeof project.coverIndex === 'number' ? project.coverIndex : 0,
        images: safeImages,
        videos: safeVideos,
        audios: safeAudios,
        isDefault: project.isDefault,
        createdAt: project.createdAt || Date.now()
      };

      if (idx > -1) {
        list[idx] = safeProject;
      } else {
        list.unshift(safeProject);
      }

      // الاحتفاظ بآخر 100 عمل بالكاش السريع مع ضغط آمن
      if (list.length > 100) {
        list = list.slice(0, 100);
      }

      const serialized = JSON.stringify(list);
      localStorage.setItem(STORAGE_CACHE_INDEX, serialized);
      localStorage.setItem('km_portfolio_projects_cache', serialized);
    } catch (e) {
      // في حال امتلاء LocalStorage يتم الاعتماد على IndexedDB بالكامل
    }
  }

  function removeLocalProjectCache(id) {
    try {
      let list = getLocalProjectsCache();
      list = list.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_CACHE_INDEX, JSON.stringify(list));
    } catch (e) {}
  }

  /* --------------------------------------------------------------------------
     3. المشاريع الافتراضية المعتمدة (مستمدة مباشرة من بيانات كريم محمود المنشورة portfolio-data.js)
     -------------------------------------------------------------------------- */
  const DEFAULT_PROJECTS = (typeof window !== 'undefined' && window.PORTFOLIO_PUBLISHED_DATA && Array.isArray(window.PORTFOLIO_PUBLISHED_DATA.projects))
    ? window.PORTFOLIO_PUBLISHED_DATA.projects
    : [];

  /* --------------------------------------------------------------------------
     4. Ø¥Ø¯Ø§Ø±Ø© Ø§Ù„Ø±ÙˆØ§Ø¨Ø· ÙˆØ§Ù„ØµÙˆØ± ÙˆØ§Ø³ØªØ¶Ø§ÙØ© Ø§Ù„ÙˆØ³Ø§Ø¦Ø· Ø§Ù„Ø®Ø§Ø±Ø¬ÙŠØ© (Cloudinary Resolver)
     -------------------------------------------------------------------------- */
  const resolveMediaUrl = (typeof window !== 'undefined' && typeof window.resolveMediaUrl === 'function')
    ? window.resolveMediaUrl
    : function(p) { return p; };

  const objectUrlMap = new Map();

  function getMediaUrl(project) {
    if (!project) return resolveMediaUrl('assets/images/medical-design-1.svg');
    // 1. Ø£Ø³Ø±Ø¹ ÙˆØ£Ø¶Ù…Ù† Ø®ÙŠØ§Ø±: Ø§Ù„Ù…Ø¹Ø§ÙŠÙ†Ø© Ø§Ù„Ù…Ø­ÙÙˆØ¸Ø© ÙƒÙ€ DataURL Ø£Ùˆ Ù…Ø³Ø§Ø±
    if (project.thumbUrl) {
      return resolveMediaUrl(project.thumbUrl);
    }
    // 2. Ø¥Ø°Ø§ ÙƒØ§Ù† Ù‡Ù†Ø§Ù„Ùƒ Blob Ù…Ø­ÙÙˆØ¸ ÙÙŠ IndexedDB Ù„ØµÙˆØ±Ø© Ø§Ù„ØºÙ„Ø§Ù
    if (project.mediaBlob && project.mediaBlob instanceof Blob) {
      if (!objectUrlMap.has(project.id)) {
        try {
          const url = URL.createObjectURL(project.mediaBlob);
          objectUrlMap.set(project.id, url);
        } catch (e) {
          return resolveMediaUrl(project.media || 'assets/images/medical-design-1.svg');
        }
      }
      return objectUrlMap.get(project.id);
    }
    // 3. Ø¥Ø°Ø§ ÙƒØ§Ù† Ø£Ù„Ø¨ÙˆÙ… ÙÙŠØ¯ÙŠÙˆ ÙˆÙ†Ø±ÙŠØ¯ ØµÙˆØ±Ø© Ø§Ù„ØºÙ„Ø§Ù Ù…Ù† Ù…ØµÙÙˆÙØ© Ø§Ù„ÙÙŠØ¯ÙŠÙˆÙ‡Ø§Øª
    if (Array.isArray(project.videos) && project.videos.length > 0) {
      const coverIdx = (typeof project.coverIndex === 'number' && project.coverIndex < project.videos.length) ? project.coverIndex : 0;
      const coverItem = project.videos[coverIdx];
      if (coverItem) {
        if (coverItem.thumbUrl) return resolveMediaUrl(coverItem.thumbUrl);
        if (coverItem.media) return resolveMediaUrl(coverItem.media);
      }
    }
    // 4. Ø¥Ø°Ø§ ÙƒØ§Ù† Ø£Ù„Ø¨ÙˆÙ… ØµÙˆØ± ÙˆÙ†Ø±ÙŠØ¯ ØµÙˆØ±Ø© Ø§Ù„ØºÙ„Ø§Ù Ù…Ù† Ù…ØµÙÙˆÙØ© Ø§Ù„ØµÙˆØ±
    if (Array.isArray(project.images) && project.images.length > 0) {
      const coverIdx = (typeof project.coverIndex === 'number' && project.coverIndex < project.images.length) ? project.coverIndex : 0;
      const coverItem = project.images[coverIdx];
      if (coverItem) {
        if (coverItem.thumbUrl) return resolveMediaUrl(coverItem.thumbUrl);
        if (coverItem.blob && coverItem.blob instanceof Blob) {
          const k = project.id + '_cover_' + coverIdx;
          if (!objectUrlMap.has(k)) {
            try {
              objectUrlMap.set(k, URL.createObjectURL(coverItem.blob));
            } catch (err) {
              return resolveMediaUrl(coverItem.media || 'assets/images/medical-design-1.svg');
            }
          }
          return objectUrlMap.get(k);
        }
        if (coverItem.media) return resolveMediaUrl(coverItem.media);
      }
    }
    // 5. Ø§Ù„Ù…Ø³Ø§Ø± Ø§Ù„Ø£ØµÙ„ÙŠ Ø£Ùˆ Ø§Ù„Ø§ÙØªØ±Ø§Ø¶ÙŠ
    return resolveMediaUrl(project.media || (project.type === 'video' ? 'assets/images/video-thumb-1.svg' : 'assets/images/medical-design-1.svg'));
  }

  // Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ Ø±Ø§Ø¨Ø· Ø£ÙŠ ØµÙˆØ±Ø© Ø£Ùˆ ÙÙŠØ¯ÙŠÙˆ Ø¯Ø§Ø®Ù„ Ø§Ù„Ø£Ù„Ø¨ÙˆÙ… Ø¨Ø§Ù„Ø­Ø¬Ù… Ø§Ù„ÙƒØ§Ù…Ù„
  function getAlbumItemUrl(project, imgObj, index) {
    if (!imgObj) return resolveMediaUrl((project && project.type === 'video') ? 'assets/images/video-thumb-1.svg' : 'assets/images/medical-design-1.svg');
    if (imgObj.blob && imgObj.blob instanceof Blob) {
      const key = project.id + '_album_media_' + index;
      if (!objectUrlMap.has(key)) {
        try {
          const url = URL.createObjectURL(imgObj.blob);
          objectUrlMap.set(key, url);
        } catch (e) {
          return resolveMediaUrl(imgObj.thumbUrl || (project.type === 'video' ? 'assets/images/video-thumb-1.svg' : 'assets/images/medical-design-1.svg'));
        }
      }
      return objectUrlMap.get(key);
    }
    if (imgObj.thumbUrl) return resolveMediaUrl(imgObj.thumbUrl);
    if (imgObj.media) return resolveMediaUrl(imgObj.media);
    return resolveMediaUrl((project && project.type === 'video') ? 'assets/images/video-thumb-1.svg' : 'assets/images/medical-design-1.svg');
  }

  function getVideoUrl(project, videoIndex = null) {
    if (!project) return '';
    const idx = (typeof videoIndex === 'number' && videoIndex >= 0)
      ? videoIndex
      : ((typeof project.coverIndex === 'number' && project.videos && project.videos[project.coverIndex]) ? project.coverIndex : 0);

    const albumItem = (Array.isArray(project.videos) && project.videos[idx]) ? project.videos[idx] : null;
    let videoBlob = (albumItem && albumItem.blob) || project.videoBlob || project.blob;
    if (!videoBlob && Array.isArray(project.videos) && project.videos.length > 0) {
      videoBlob = project.videos[0].blob;
    }

    if (videoBlob && !(videoBlob instanceof Blob) && (videoBlob instanceof ArrayBuffer || ArrayBuffer.isView(videoBlob))) {
      try {
        videoBlob = new Blob([videoBlob], { type: 'video/mp4' });
      } catch (e) {}
    }

    if (videoBlob && videoBlob instanceof Blob) {
      const key = (project.id || 'proj') + '_video_' + idx;
      if (!objectUrlMap.has(key)) {
        try {
          const url = URL.createObjectURL(videoBlob);
          objectUrlMap.set(key, url);
        } catch (e) {
          const fallback = (albumItem && albumItem.videoUrl) || project.videoUrl || '';
          return resolveMediaUrl(fallback);
        }
      }
      return objectUrlMap.get(key);
    }

    if (typeof videoBlob === 'string' && (videoBlob.startsWith('data:video/') || videoBlob.startsWith('blob:'))) {
      return videoBlob;
    }

    const rawUrl = (albumItem && albumItem.videoUrl) || project.videoUrl || '';
    return resolveMediaUrl(rawUrl);
  }

  function getAudioUrl(project, audioItem) {
    if (!project) return null;
    const firstAudioBlob = (project.audios && project.audios[0] && project.audios[0].blob) || null;
    const blobToUse = (audioItem && audioItem.blob) || project.audioBlob || project.mediaBlob || firstAudioBlob;
    if (blobToUse && blobToUse instanceof Blob) {
      const key = (project.id || 'proj') + '_audio_' + (audioItem ? audioItem.id : 'main');
      if (!objectUrlMap.has(key)) {
        try {
          const url = URL.createObjectURL(blobToUse);
          objectUrlMap.set(key, url);
        } catch (e) {
          return null;
        }
      }
      return objectUrlMap.get(key);
    }
    if (audioItem && audioItem.url) return resolveMediaUrl(audioItem.url);
    if (project.audioUrl) return resolveMediaUrl(project.audioUrl);
    if (typeof project.media === 'string' && (project.media.endsWith('.mp3') || project.media.endsWith('.wav') || project.media.endsWith('.m4a') || project.media.endsWith('.ogg'))) {
      return resolveMediaUrl(project.media);
    }
    return null;
  }
  function isCartoonItem(item) {
    if (!item) return false;
    if (item.isCartoon === true) return true;
    if (item.type === 'cartoon') return true;
    const cat = item.category || '';
    const title = item.title || '';
    if (cat.includes('كرتون') || title.includes('كرتون')) return true;
    if (cat.includes('نصائح') || title.includes('نصائح')) return true;
    return false;
  }

  const CAPACITY_LIMIT_IMAGES = 200;
  const CAPACITY_LIMIT_VIDEOS = 50;
  const CAPACITY_LIMIT_CARTOONS = 50;
  const CAPACITY_LIMIT_AUDIOS = 50;

  // ضغط وتحسين الصور قبل التخزين لضمان استيعاب 200 صورة بدقة فائقة وبأقل حجم
  function optimizeImageBlob(file, maxDimension = 2048, quality = 0.88) {
    return new Promise((resolve) => {
      if (!file || !file.type.startsWith('image/')) {
        resolve(file);
        return;
      }
      if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
        resolve(file);
        return;
      }

      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          try {
            let width = img.width;
            let height = img.height;

            if (width <= maxDimension && height <= maxDimension && file.size < 1200000) {
              resolve(file);
              return;
            }

            if (width > maxDimension || height > maxDimension) {
              if (width > height) {
                height = Math.round((height * maxDimension) / width);
                width = maxDimension;
              } else {
                width = Math.round((width * maxDimension) / height);
                height = maxDimension;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
              (blob) => {
                if (blob && blob.size < file.size) {
                  resolve(blob);
                } else {
                  resolve(file);
                }
              },
              'image/jpeg',
              quality
            );
          } catch (err) {
            resolve(file);
          }
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  }

  // توليد صورة مصغرة سريعة ودائمة من أي ملف صورة
  function generateThumbnail(file) {
    return new Promise((resolve) => {
      if (!file || !file.type.startsWith('image/')) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          try {
            const maxDim = 640;
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
              if (width > height) {
                height = Math.round((height * maxDim) / width);
                width = maxDim;
              } else {
                width = Math.round((width * maxDim) / height);
                height = maxDim;
              }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const thumbUrl = canvas.toDataURL('image/jpeg', 0.82);
            resolve(thumbUrl);
          } catch (err) {
            resolve(e.target.result);
          }
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }

  // توليد بوستر مصغر تلقائي فوري لأي فيديو مرفوع لضمان خفة وسرعة المعرض لـ 50 فيديو
  function generateVideoThumbnail(videoFile) {
    return new Promise((resolve) => {
      if (!videoFile || !videoFile.type.startsWith('video/')) {
        resolve('assets/images/video-thumb-1.svg');
        return;
      }
      try {
        const url = URL.createObjectURL(videoFile);
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = url;
        video.muted = true;
        video.playsInline = true;

        let resolved = false;
        const cleanup = () => {
          try { URL.revokeObjectURL(url); } catch (e) {}
        };

        const captureFrame = () => {
          if (resolved) return;
          resolved = true;
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 640;
            let w = video.videoWidth || 640;
            let h = video.videoHeight || 360;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
            cleanup();
            resolve(dataUrl);
          } catch (e) {
            cleanup();
            resolve('assets/images/video-thumb-1.svg');
          }
        };

        video.addEventListener('seeked', captureFrame);
        video.addEventListener('loadeddata', () => {
          try { video.currentTime = 0.5; } catch (e) { captureFrame(); }
        });
        video.addEventListener('error', () => {
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve('assets/images/video-thumb-1.svg');
          }
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            captureFrame();
          }
        }, 3000);
      } catch (err) {
        resolve('assets/images/video-thumb-1.svg');
      }
    });
  }

  // حساب دقيق لعدد الصور والفيديوهات والكرتون والتعليق الصوتي المحفوظة لتحديث مؤشرات السعة
  function calculateMediaCounts() {
    let imagesCount = 0;
    let videosCount = 0;
    let cartoonsCount = 0;
    let audiosCount = 0;

    for (const p of cachedAllProjects) {
      if (p.isDefault || (typeof p.id === 'string' && (p.id.startsWith('def-') || p.id.startsWith('dummy-')))) continue;
      if (isCartoonItem(p)) {
        if (Array.isArray(p.videos) && p.videos.length > 0) {
          cartoonsCount += p.videos.length;
        } else {
          cartoonsCount += 1;
        }
      } else if (p.type === 'video') {
        if (Array.isArray(p.videos) && p.videos.length > 0) {
          videosCount += p.videos.length;
        } else {
          videosCount += 1;
        }
      } else if (p.type === 'audio') {
        if (Array.isArray(p.audios) && p.audios.length > 0) {
          audiosCount += p.audios.length;
        } else {
          audiosCount += 1;
        }
      } else {
        if (Array.isArray(p.images) && p.images.length > 0) {
          imagesCount += p.images.length;
        } else {
          imagesCount += 1;
        }
      }
    }

    return { imagesCount, videosCount, cartoonsCount, audiosCount };
  }

  // تحديث لوحة ومؤشرات سعة التخزين في واجهة المستخدم
  async function updateCapacityDashboard() {
    const { imagesCount, videosCount, cartoonsCount, audiosCount } = calculateMediaCounts();

    const imagesFill = document.getElementById('imagesCapacityFill');
    const imagesCountEl = document.getElementById('imagesCapacityCount');
    const imagesRemainEl = document.getElementById('imagesCapacityRemaining');

    const videosFill = document.getElementById('videosCapacityFill');
    const videosCountEl = document.getElementById('videosCapacityCount');
    const videosRemainEl = document.getElementById('videosCapacityRemaining');

    const cartoonsFill = document.getElementById('cartoonsCapacityFill');
    const cartoonsCountEl = document.getElementById('cartoonsCapacityCount');
    const cartoonsRemainEl = document.getElementById('cartoonsCapacityRemaining');

    const audioFill = document.getElementById('audioCapacityFill');
    const audioCountEl = document.getElementById('audioCapacityCount');
    const audioRemainEl = document.getElementById('audioCapacityRemaining');

    const diskEstimateText = document.getElementById('capacityDiskEstimateText');

    const imgPct = Math.min(100, Math.round((imagesCount / CAPACITY_LIMIT_IMAGES) * 100));
    const totalVideosCount = Math.max(13, videosCount);
    const vidPct = Math.min(100, Math.round((totalVideosCount / CAPACITY_LIMIT_VIDEOS) * 100));
    const carPct = Math.min(100, Math.round((cartoonsCount / CAPACITY_LIMIT_CARTOONS) * 100));
    const audPct = Math.min(100, Math.round((audiosCount / CAPACITY_LIMIT_AUDIOS) * 100));

    if (imagesCountEl) imagesCountEl.textContent = `${imagesCount} / ${CAPACITY_LIMIT_IMAGES} صورة (${imgPct}%)`;
    if (imagesFill) imagesFill.style.width = `${imgPct}%`;
    if (imagesRemainEl) {
      const remaining = Math.max(0, CAPACITY_LIMIT_IMAGES - imagesCount);
      imagesRemainEl.textContent = remaining > 0 
        ? `متبقي مساحة لـ ${remaining} صورة إضافية`
        : 'تم استيفاء سعة الـ 200 صورة بالكامل';
    }

    if (videosCountEl) videosCountEl.textContent = `${totalVideosCount} / ${CAPACITY_LIMIT_VIDEOS} فيديو (${vidPct}%)`;
    if (videosFill) videosFill.style.width = `${vidPct}%`;
    if (videosRemainEl) {
      const remaining = Math.max(0, CAPACITY_LIMIT_VIDEOS - totalVideosCount);
      videosRemainEl.textContent = remaining > 0 
        ? `متبقي مساحة لـ ${remaining} فيديو إضافي`
        : 'تم استيفاء سعة الـ 50 فيديو بالكامل';
    }

    if (cartoonsCountEl) cartoonsCountEl.textContent = `${cartoonsCount} / ${CAPACITY_LIMIT_CARTOONS} فيديو (${carPct}%)`;
    if (cartoonsFill) cartoonsFill.style.width = `${carPct}%`;
    if (cartoonsRemainEl) {
      const remaining = Math.max(0, CAPACITY_LIMIT_CARTOONS - cartoonsCount);
      cartoonsRemainEl.textContent = remaining > 0 
        ? `متبقي مساحة لـ ${remaining} فيديو كرتوني`
        : 'تم استيفاء سعة الـ 50 فيديو كرتوني بالكامل';
    }

    if (audioCountEl) audioCountEl.textContent = `${audiosCount} / ${CAPACITY_LIMIT_AUDIOS} تسجيل (${audPct}%)`;
    if (audioFill) audioFill.style.width = `${audPct}%`;
    if (audioRemainEl) {
      const remaining = Math.max(0, CAPACITY_LIMIT_AUDIOS - audiosCount);
      audioRemainEl.textContent = remaining > 0 
        ? `متبقي مساحة لـ ${remaining} مقطع صوتي`
        : 'تم استيفاء سعة الـ 50 مقطع صوتي';
    }

    // تقدير مساحة التخزين المتاحة من نظام المتصفح
    if (diskEstimateText && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const quotaGB = (est.quota / (1024 * 1024 * 1024)).toFixed(1);
        const usedMB = (est.usage / (1024 * 1024)).toFixed(1);
        diskEstimateText.textContent = `المساحة المتاحة بالمتصفح: ${quotaGB} جيجابايت (المستخدم: ${usedMB} ميجابايت) • السعة المخصصة: 200 صورة • 50 فيديو AI • 50 كرتون • 50 تعليق صوتي`;
      } catch (e) {
        diskEstimateText.textContent = `سعة مستديمة مخصصة تتسع لـ 200 صورة • 50 فيديو AI • 50 كرتون • 50 تعليق صوتي`;
      }
    }
  }

  // تفعيل خاصية التخزين المستديم لحماية الأعمال من الحذف بتاتاً
  async function requestPersistentStorage() {
    if (navigator.storage && navigator.storage.persist) {
      try {
        const isPersisted = await navigator.storage.persist();
        const badge = document.getElementById('capacityPersistBadge');
        if (badge) {
          badge.style.display = 'inline-flex';
          badge.title = isPersisted ? 'تم تفعيل التخزين الدائم غير القابل للمسح' : 'التخزين المحلي مفعل';
        }
      } catch (e) {}
    }
  }

  /* --------------------------------------------------------------------------
     5. الحالة العامة وعناصر الصفحة
     -------------------------------------------------------------------------- */
  let currentFilter = 'all';
  let activeLightboxIndex = 0;
  let currentFilteredDesigns = [];
  let pendingDeleteId = null;

  // حد العرض التراكمي الذكي (يضمن ظهور كل المشاريع المرفوعة دائماً)
  const BASE_PAGE_SIZE = 24;
  let visibleLimit = BASE_PAGE_SIZE;
  let cachedAllProjects = (typeof DEFAULT_PROJECTS !== 'undefined' && Array.isArray(DEFAULT_PROJECTS)) ? deduplicateProjects([...DEFAULT_PROJECTS]) : [];

  // الملفات المحددة حالياً في نافذة الإضافة (تجميع تراكمي للألبوم)
  let selectedBatchFiles = [];
  let selectedCoverIndex = 0;
  let batchThumbnailsCache = [];

  // حالة عارض اللايت بوكس للألبومات والأعمال الفردية
  let currentLightboxProject = null;
  let activeAlbumIndex = 0;

  // العناصر في DOM
  const docHtml = document.documentElement;
  const siteHeader = document.getElementById('siteHeader');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const navMenu = document.getElementById('navMenu');
  const navLinks = document.querySelectorAll('.nav-link');

  const brandAvatarBox = document.getElementById('brandAvatarBox');
  const brandAvatarImg = document.getElementById('brandAvatarImg');
  const brandMonogramFallback = document.getElementById('brandMonogramFallback');
  const brandPhotoChangeBtn = document.getElementById('brandPhotoChangeBtn');
  const brandPhotoResetBtn = document.getElementById('brandPhotoResetBtn');
  const brandFileInput = document.getElementById('brandFileInput');

  const profileAvatarImg = document.getElementById('profileAvatarImg');
  const photoChangeBtn = document.getElementById('photoChangeBtn');
  const photoFileInput = document.getElementById('photoFileInput');
  const photoResetBtn = document.getElementById('photoResetBtn');

  const portfolioGrid = document.getElementById('portfolioGrid');
  const filterTabBtns = document.querySelectorAll('.filter-tab-btn');
  const btnAddAudio = document.getElementById('btnAddAudio');
  const btnAddDesign = document.getElementById('btnAddDesign');
  const btnAddVideo = document.getElementById('btnAddVideo');
  const btnAddCartoon = document.getElementById('btnAddCartoon');
  const portfolioCountText = document.getElementById('portfolioCountText');
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const btnLoadMore = document.getElementById('btnLoadMore');
  const btnLoadAll = document.getElementById('btnLoadAll');
  const loadMoreCountText = document.getElementById('loadMoreCountText');

  const btnPublishData = document.getElementById('btnPublishData');
  const btnExportData = document.getElementById('btnExportData');
  const btnImportData = document.getElementById('btnImportData');
  const backupFileInput = document.getElementById('backupFileInput');

  const lightboxOverlay = document.getElementById('lightboxOverlay');
  const lightboxImage = document.getElementById('lightboxImage');
  const lightboxTitle = document.getElementById('lightboxTitle');
  const lightboxDesc = document.getElementById('lightboxDesc');
  const lightboxCloseBtn = document.getElementById('lightboxCloseBtn');
  const lightboxPrevBtn = document.getElementById('lightboxPrevBtn');
  const lightboxNextBtn = document.getElementById('lightboxNextBtn');
  const lightboxCounter = document.getElementById('lightboxCounter');
  const lightboxThumbsStrip = document.getElementById('lightboxThumbsStrip');

  const videoModalOverlay = document.getElementById('videoModalOverlay');
  const videoPlayerContainer = document.getElementById('videoPlayerContainer');
  const videoModalTitle = document.getElementById('videoModalTitle');
  const videoModalDesc = document.getElementById('videoModalDesc');
  const videoModalCloseBtn = document.getElementById('videoModalCloseBtn');

  const projectModalOverlay = document.getElementById('projectModalOverlay');
  const projectModalHeading = document.getElementById('projectModalHeading');
  const modalTypeSwitcher = document.getElementById('modalTypeSwitcher');
  const projectModalCloseBtn = document.getElementById('projectModalCloseBtn');
  const projectModalCancelBtn = document.getElementById('projectModalCancelBtn');
  const projectForm = document.getElementById('projectForm');
  const projectEditId = document.getElementById('projectEditId');
  const projectFormType = document.getElementById('projectFormType');
  const projectTitleInput = document.getElementById('projectTitleInput');
  const projectCategoryInput = document.getElementById('projectCategoryInput');
  const projectDescInput = document.getElementById('projectDescInput');
  const projectFileInput = document.getElementById('projectFileInput');
  const projectUrlInput = document.getElementById('projectUrlInput');
  const mediaUploadLabel = document.getElementById('mediaUploadLabel');
  const videoAspectGroup = document.getElementById('videoAspectGroup');
  const videoAspectSelect = document.getElementById('videoAspectSelect');

  const modalSavedCountText = document.getElementById('modalSavedCountText');
  const dropzoneArea = document.getElementById('dropzoneArea');
  const dropzoneTitle = document.getElementById('dropzoneTitle');
  const batchPreviewStrip = document.getElementById('batchPreviewStrip');
  const modalAlbumPreviewGrid = document.getElementById('modalAlbumPreviewGrid');
  const batchProgressWrapper = document.getElementById('batchProgressWrapper');
  const batchProgressFill = document.getElementById('batchProgressFill');
  const batchProgressText = document.getElementById('batchProgressText');
  const batchProgressPercent = document.getElementById('batchProgressPercent');

  const deleteConfirmOverlay = document.getElementById('deleteConfirmOverlay');
  const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
  const deleteCancelBtn = document.getElementById('deleteCancelBtn');
  const deleteCancelBtnTop = document.getElementById('deleteCancelBtnTop');

  const contactForm = document.getElementById('contactForm');
  const toastNotice = document.getElementById('toastNotice');
  const toastMessage = document.getElementById('toastMessage');

  /* --------------------------------------------------------------------------
     6. نظام الإشعارات (Toast Notice)
     -------------------------------------------------------------------------- */
  let toastTimer = null;
  function showToast(message, duration = 3500) {
    if (!toastNotice || !toastMessage) return;
    toastMessage.textContent = message;
    toastNotice.classList.add('show');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastNotice.classList.remove('show');
    }, duration);
  }

  /* --------------------------------------------------------------------------
     7. الوضع الليلي والنهاري والتنقل
     -------------------------------------------------------------------------- */
  function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_THEME);
    const preferredTheme = savedTheme || 'dark';
    applyTheme(preferredTheme);

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        const current = docHtml.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem(STORAGE_THEME, next);
        showToast(next === 'dark' ? 'تم التبديل إلى الوضع الليلي' : 'تم التبديل إلى الوضع النهاري');
      });
    }
  }

  function applyTheme(theme) {
    docHtml.setAttribute('data-theme', theme);
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', theme === 'dark' ? '#060913' : '#f8fafc');
    }
  }

  function initNavigation() {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 30) {
        siteHeader.classList.add('scrolled');
      } else {
        siteHeader.classList.remove('scrolled');
      }
    }, { passive: true });

    if (mobileMenuBtn && navMenu) {
      mobileMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = navMenu.classList.toggle('open');
        mobileMenuBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });

      navLinks.forEach((link) => {
        link.addEventListener('click', () => {
          navMenu.classList.remove('open');
          mobileMenuBtn.setAttribute('aria-expanded', 'false');
        });
      });

      document.addEventListener('click', (e) => {
        if (!navMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
          navMenu.classList.remove('open');
          mobileMenuBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    const sections = document.querySelectorAll('section[id]');
    if ('IntersectionObserver' in window && sections.length > 0) {
      const sectionObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const currentId = entry.target.getAttribute('id');
            navLinks.forEach((link) => {
              const href = link.getAttribute('href');
              if (href === `#${currentId}`) {
                link.classList.add('active');
              } else {
                link.classList.remove('active');
              }
            });
          }
        });
      }, {
        rootMargin: '-20% 0px -65% 0px',
        threshold: 0
      });

      sections.forEach((sec) => sectionObserver.observe(sec));
    }
  }

  function initScrollReveal() {
    const revealElements = document.querySelectorAll('.reveal-on-scroll');
    if (!('IntersectionObserver' in window)) {
      revealElements.forEach((el) => el.classList.add('revealed'));
      return;
    }

    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, {
      rootMargin: '0px 0px -50px 0px',
      threshold: 0.1
    });

    revealElements.forEach((el) => revealObserver.observe(el));
  }

  /* --------------------------------------------------------------------------
     8. إدارة الصورة الشخصية (حفظ دائم في IndexedDB والكاش)
     -------------------------------------------------------------------------- */
  async function initProfilePhoto() {
    const defaultAvatarUrl = 'assets/images/default-avatar.svg';

    try {
      const savedPhoto = (await dbGetSetting(SETTING_PHOTO))
        || (window.PORTFOLIO_PUBLISHED_DATA && window.PORTFOLIO_PUBLISHED_DATA.settings && window.PORTFOLIO_PUBLISHED_DATA.settings.avatar);
      if (savedPhoto && profileAvatarImg) {
        if (savedPhoto instanceof Blob) {
          profileAvatarImg.src = URL.createObjectURL(savedPhoto);
        } else {
          profileAvatarImg.src = resolveMediaUrl(savedPhoto);
        }
        if (photoResetBtn) photoResetBtn.style.display = 'inline-block';
      }
    } catch (e) {
      console.warn('تعذر استرجاع الصورة من IndexedDB:', e);
    }

    if (photoChangeBtn && photoFileInput) {
      photoChangeBtn.addEventListener('click', () => {
        photoFileInput.click();
      });
    }

    if (photoFileInput) {
      photoFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          showToast('يرجى اختيار ملف صورة صالح');
          return;
        }

        try {
          await dbSaveSetting(SETTING_PHOTO, file);
          const newUrl = URL.createObjectURL(file);
          if (profileAvatarImg) profileAvatarImg.src = newUrl;
          if (photoResetBtn) photoResetBtn.style.display = 'inline-block';
          showToast('تم تحديث الصورة الشخصية بنجاح!');
        } catch (err) {
          console.error(err);
          showToast('حدث خطأ أثناء حفظ الصورة');
        }

        photoFileInput.value = '';
      });
    }

    if (photoResetBtn) {
      photoResetBtn.addEventListener('click', async () => {
        try {
          await dbSaveSetting(SETTING_PHOTO, null);
          if (profileAvatarImg) profileAvatarImg.src = defaultAvatarUrl;
          photoResetBtn.style.display = 'none';
          showToast('تمت استعادة الصورة الشخصية الافتراضية');
        } catch (e) {
          console.error(e);
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     8.1. إدارة صورة شعار الهوية في الشريط العلوي (حفظ دائم في IndexedDB)
     -------------------------------------------------------------------------- */
  async function initBrandLogo() {
    if (!brandAvatarBox && !brandAvatarImg) return;

    // استرجاع الشعار المحفوظ مسبقاً
    try {
      const savedLogo = (await dbGetSetting(SETTING_BRAND_LOGO))
        || (window.PORTFOLIO_PUBLISHED_DATA && window.PORTFOLIO_PUBLISHED_DATA.settings && window.PORTFOLIO_PUBLISHED_DATA.settings.brandLogo);
      if (savedLogo && brandAvatarImg) {
        if (savedLogo instanceof Blob) {
          brandAvatarImg.src = URL.createObjectURL(savedLogo);
        } else {
          brandAvatarImg.src = resolveMediaUrl(savedLogo);
        }
        if (brandAvatarImg) {
          brandAvatarImg.style.display = 'block';
          brandAvatarImg.classList.remove('hidden');
        }
        if (brandMonogramFallback) {
          brandMonogramFallback.style.display = 'none';
          brandMonogramFallback.classList.add('hidden');
        }
        if (brandPhotoResetBtn) {
          brandPhotoResetBtn.style.display = 'flex';
          brandPhotoResetBtn.classList.remove('hidden');
        }
      }
    } catch (e) {
      console.warn('تعذر استرجاع صورة الشعار من IndexedDB:', e);
    }

    // فتح نافذة اختيار الملفات عند النقر على الشعار أو زر التغيير
    const triggerUpload = () => {
      if (brandFileInput) brandFileInput.click();
    };

    if (brandPhotoChangeBtn) {
      brandPhotoChangeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerUpload();
      });
    }

    if (brandAvatarBox) {
      brandAvatarBox.addEventListener('click', (e) => {
        if (e.target.closest('#brandPhotoResetBtn')) return;
        triggerUpload();
      });

      brandAvatarBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerUpload();
        }
      });
    }

    // معالجة اختيار صورة الشعار
    if (brandFileInput) {
      brandFileInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
          showToast('يرجى اختيار ملف صورة صالح للشعار');
          return;
        }

        try {
          await dbSaveSetting(SETTING_BRAND_LOGO, file);
          const newUrl = URL.createObjectURL(file);
          if (brandAvatarImg) {
            brandAvatarImg.src = newUrl;
            brandAvatarImg.style.display = 'block';
            brandAvatarImg.classList.remove('hidden');
          }
          if (brandMonogramFallback) {
            brandMonogramFallback.style.display = 'none';
            brandMonogramFallback.classList.add('hidden');
          }
          if (brandPhotoResetBtn) {
            brandPhotoResetBtn.style.display = 'flex';
            brandPhotoResetBtn.classList.remove('hidden');
          }
          showToast('تم تحديث صورة الشعار في الشريط بنجاح!');
        } catch (err) {
          console.error(err);
          showToast('حدث خطأ أثناء حفظ صورة الشعار');
        }

        brandFileInput.value = '';
      });
    }

    // زر استعادة الشعار الافتراضي
    if (brandPhotoResetBtn) {
      brandPhotoResetBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await dbSaveSetting(SETTING_BRAND_LOGO, null);
          if (brandAvatarImg) {
            brandAvatarImg.src = '';
            brandAvatarImg.style.display = 'none';
            brandAvatarImg.classList.add('hidden');
          }
          if (brandMonogramFallback) {
            brandMonogramFallback.style.display = 'flex';
            brandMonogramFallback.classList.remove('hidden');
          }
          brandPhotoResetBtn.style.display = 'none';
          brandPhotoResetBtn.classList.add('hidden');
          showToast('تمت استعادة الأيقونة الافتراضية');
        } catch (err) {
          console.error(err);
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     9. مزامنة وتحميل كل المشاريع (التراكمية الدائمة والمنشورة للزوار)
     -------------------------------------------------------------------------- */
  async function syncAndLoadAllProjects() {
    try {
      const userProjects = await dbGetAllProjects();

      // استرجاع الأعمال المنشورة مسبقاً في الموقع للزوار
      const publishedProjects = (window.PORTFOLIO_PUBLISHED_DATA && Array.isArray(window.PORTFOLIO_PUBLISHED_DATA.projects))
        ? window.PORTFOLIO_PUBLISHED_DATA.projects
        : [];

      // دمج المشاريع مع استبعاد أي تكرار تلقائياً (المشاريع الافتراضية، المنشورة، والمحلية)
      const mergedMap = new Map();
      for (const p of DEFAULT_PROJECTS) {
        if (p && p.id) mergedMap.set(p.id, p);
      }
      for (const p of publishedProjects) {
        if (p && p.id) mergedMap.set(p.id, p);
      }
      for (const p of userProjects) {
        if (p && p.id) mergedMap.set(p.id, p);
      }

      const isExcluded = (p) => isCartoonItem(p) || (p.type === 'video' && typeof p.id === 'string' && !p.id.startsWith('yt-vid-'));
      for (const p of userProjects) {
        if (isExcluded(p)) {
          try { deleteProjectFromDB(p.id); } catch (e) {}
        }
      }
      const allMerged = Array.from(mergedMap.values()).filter(p => !isExcluded(p));
      const deduplicated = deduplicateProjects(allMerged);
      const sortedUserProjects = deduplicated.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      cachedAllProjects = sortedUserProjects;

      // حد العرض التراكمي الأولي السريع للأعداد الكبيرة (حتى 250 عملاً)
      if (visibleLimit < BASE_PAGE_SIZE) {
        visibleLimit = BASE_PAGE_SIZE;
      }

      updatePortfolioStats();
      await updateCapacityDashboard();
      renderPortfolio();
    } catch (err) {
      console.error('خطأ في تحميل المشاريع:', err);
      const publishedProjects = (window.PORTFOLIO_PUBLISHED_DATA && Array.isArray(window.PORTFOLIO_PUBLISHED_DATA.projects))
        ? window.PORTFOLIO_PUBLISHED_DATA.projects
        : [];
      const mergedMap = new Map();
      for (const p of DEFAULT_PROJECTS) {
        if (p && p.id) mergedMap.set(p.id, p);
      }
      for (const p of publishedProjects) {
        if (p && p.id) mergedMap.set(p.id, p);
      }
      cachedAllProjects = deduplicateProjects(Array.from(mergedMap.values())).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      updatePortfolioStats();
      await updateCapacityDashboard();
      renderPortfolio();
    }
  }

  /* --------------------------------------------------------------------------
     دالة إزالة التكرار الصارمة للمشاريع (تمنع تكرار أي فيديو أو صوت أو تصميم نهائياً)
     -------------------------------------------------------------------------- */
  function deduplicateProjects(list) {
    if (!Array.isArray(list)) return [];
    const seenIds = new Set();
    const seenMedia = new Set();
    const seenTitles = new Set();
    const result = [];

    for (const p of list) {
      if (!p) continue;
      if (p.id && seenIds.has(p.id)) continue;

      // رابط الفيديو أو الصوت الفعلي
      const mediaKey = (p.videoUrl || p.audioUrl || (p.type === 'design' ? p.media : '') || '').trim().toLowerCase();
      if (mediaKey && seenMedia.has(mediaKey)) continue;

      // العنوان الموحد المنظف من المسافات وعلامات الترقيم
      const normTitle = (p.title || '')
        .toLowerCase()
        .replace(/[^\u0600-\u06FFa-zA-Z0-9]/g, '')
        .trim();
      if (normTitle && seenTitles.has(normTitle)) continue;

      // فحص التشابه الخاص بمشاريع كريم المحددة لضمان عدم التكرار
      if (normTitle.includes('الفتقالاربي') && normTitle.includes('شتيوي')) {
        if (seenTitles.has('shtiwi_hernia_seen')) continue;
        seenTitles.add('shtiwi_hernia_seen');
      }
      if (normTitle.includes('نصراكتوبر') && normTitle.includes('المعدة')) {
        if (seenTitles.has('october_stomach_seen')) continue;
        seenTitles.add('october_stomach_seen');
      }
      if (normTitle.includes('الابواء') && normTitle.includes('غزوات')) {
        if (seenTitles.has('abwaa_seen')) continue;
        seenTitles.add('abwaa_seen');
      }
      if (normTitle.includes('اوميجا') || normTitle.includes('اوميغا')) {
        if (seenTitles.has('omega_seen')) continue;
        seenTitles.add('omega_seen');
      }
      if (normTitle.includes('التقسيط') && normTitle.includes('السمنة')) {
        if (seenTitles.has('installments_seen')) continue;
        seenTitles.add('installments_seen');
      }

      if (p.id) seenIds.add(p.id);
      if (mediaKey) seenMedia.add(mediaKey);
      if (normTitle) seenTitles.add(normTitle);
      result.push(p);
    }

    return result;
  }

  function updatePortfolioStats() {
    if (!portfolioCountText) return;
    const total = cachedAllProjects.filter((p) => !p.id.startsWith('yt-vid-')).length + 13;
    const userCount = cachedAllProjects.filter((p) => !p.isDefault).length;
    const designsCount = cachedAllProjects.filter((p) => p.type === 'design').length;
    const videosCount = 13;
    const cartoonsCount = 0;
    const audiosCount = cachedAllProjects.filter((p) => p.type === 'audio').length;

    const parts = [];
    if (videosCount > 0) parts.push(`${videosCount} فيديو`);
    if (cartoonsCount > 0) parts.push(`${cartoonsCount} كرتون`);
    if (audiosCount > 0) parts.push(`${audiosCount} تعليق صوتي`);
    if (designsCount > 0) parts.push(`${designsCount} تصميم`);

    const imgAlbums = cachedAllProjects.filter((p) => p.type === 'design' && Array.isArray(p.images) && p.images.length > 1).length;
    const vidAlbums = cachedAllProjects.filter((p) => p.type === 'video' && ((Array.isArray(p.videos) && p.videos.length > 1) || p.isAlbum)).length;
    const totalAlbums = imgAlbums + vidAlbums;
    const albumNote = totalAlbums > 0 ? ` (${totalAlbums} ألبوم هولوجرامي)` : '';

    const detailsStr = parts.length > 0 ? ` (${parts.join(' • ')}${albumNote})` : '';
    portfolioCountText.textContent = `إجمالي الأعمال: ${total} عمل${detailsStr}`;
    updateFilterTabsVisibility();

    const videoGallerySection = document.getElementById('videoGallerySection');
    if (videoGallerySection) {
      if (currentFilter === 'all' || currentFilter === 'video') {
        videoGallerySection.style.display = 'flex';
      } else {
        videoGallerySection.style.display = 'none';
      }
    }
  }

  /* --------------------------------------------------------------------------
     إخفاء القوائم والتبويبات الفارغة ديناميكياً (فقط ما رفعه كريم هو المعروض)
     -------------------------------------------------------------------------- */
  function updateFilterTabsVisibility() {
    if (!filterTabBtns || filterTabBtns.length === 0) return;
    const countVideo = (cachedAllProjects || []).filter((p) => p && p.type === 'video').length;
    const countCartoons = (cachedAllProjects || []).filter((p) => p && isCartoonItem(p)).length;
    const countAudio = (cachedAllProjects || []).filter((p) => p && p.type === 'audio').length;
    const countDesign = (cachedAllProjects || []).filter((p) => p && p.type === 'design').length;
    const counts = {
      all: (cachedAllProjects || []).filter((p) => !p.id.startsWith('yt-vid-')).length + Math.max(11, countVideo),
      video: Math.max(11, countVideo),
      cartoons: countCartoons,
      audio: countAudio,
      design: countDesign
    };

    filterTabBtns.forEach((btn) => {
      const filter = btn.getAttribute('data-filter');
      const count = counts[filter] !== undefined ? counts[filter] : 0;
      if (filter !== 'all' && count === 0) {
        btn.style.display = 'none';
        btn.setAttribute('aria-hidden', 'true');
      } else {
        btn.style.display = '';
        btn.removeAttribute('aria-hidden');
      }
    });

    if (currentFilter !== 'all' && counts[currentFilter] === 0) {
      currentFilter = 'all';
      filterTabBtns.forEach((b) => {
        if (b.getAttribute('data-filter') === 'all') {
          b.classList.add('active');
          b.setAttribute('aria-selected', 'true');
        } else {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     10. رسم المعرض التفاعلي (فيديوهات بالأعلى، كرتون، تعليق صوتي، وتصاميم)
     -------------------------------------------------------------------------- */
  function renderPortfolio() {
    if (!portfolioGrid) return;
    updateFilterTabsVisibility();

    const videoGallerySection = document.getElementById('videoGallerySection');
    if (videoGallerySection) {
      if (currentFilter === 'all' || currentFilter === 'video') {
        videoGallerySection.style.display = 'flex';
      } else {
        videoGallerySection.style.display = 'none';
      }
    }

    const filtered = cachedAllProjects.filter((item) => {
      if (currentFilter === 'all') return true;
      if (currentFilter === 'cartoons') return isCartoonItem(item);
      if (currentFilter === 'video') return item.type === 'video';
      return item.type === currentFilter;
    });

    const totalFiltered = filtered.length;

    if (totalFiltered === 0) {
      portfolioGrid.innerHTML = `
        <div style="width: 100%; text-align: center; padding: 4rem 1rem; color: var(--text-muted);">
          <p style="font-size: 1.15rem; margin-bottom: 0.5rem; font-weight: 700;">لا توجد مشاريع في هذا القسم حالياً.</p>
          <span style="font-size: 0.95rem;">اضغط على "+ إضافة فيديو" أو "+ إضافة تعليق صوتي" أو "+ إضافة تصميم" لرفع أعمالك من جهازك.</span>
        </div>
      `;
      if (loadMoreContainer) loadMoreContainer.style.display = 'none';
      return;
    }

    if (currentFilter === 'all') {
      const audios = filtered.filter((p) => p.type === 'audio');
      const designs = filtered.filter((p) => p.type === 'design');

      let html = '';

      if (audios.length > 0) {
        html += `
          <section class="portfolio-group-section audio-group" aria-label="التعليق الصوتي Voice Over">
            <div class="portfolio-group-header">
              <div class="group-header-info">
                <div class="group-icon-box audio-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                </div>
                <div>
                  <h3 class="group-title">التعليق الصوتي (Voice Over)</h3>
                  <span class="group-subtitle">تسجيلات ونماذج صوتية احترافية بالذكاء الاصطناعي مع مشغل صوتي مدمج</span>
                </div>
              </div>
              <span class="group-count-badge badge-emerald">${audios.length} تسجيل صوتي</span>
            </div>
            <div class="portfolio-subgrid audio-subgrid">
              ${audios.map((item) => createProjectCardHtml(item)).join('')}
            </div>
          </section>
        `;
      }

      // 4. التصاميم والصور بحاجتها تحت التعليق الصوتي
      if (designs.length > 0) {
        html += `
          <section class="portfolio-group-section designs-group" aria-label="تصاميم السوشيال ميديا الطبية والصور">
            <div class="portfolio-group-header">
              <div class="group-header-info">
                <div class="group-icon-box design-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                </div>
                <div>
                  <h3 class="group-title">تصاميم السوشيال ميديا الطبية والصور</h3>
                  <span class="group-subtitle">معروضة تحت الفيديوهات والتعليق الصوتي جنباً إلى جنب</span>
                </div>
              </div>
              <span class="group-count-badge badge-cyan">${designs.length} تصميم</span>
            </div>
            <div class="portfolio-subgrid designs-subgrid">
              ${designs.map((item) => createProjectCardHtml(item)).join('')}
            </div>
          </section>
        `;
      }

      portfolioGrid.innerHTML = html;
      attachCardEvents();

      if (loadMoreContainer) {
        loadMoreContainer.style.display = 'none';
      }

    } else {
      // عند التصفية على تبويب محدد منفصلاً
      let groupClass = 'designs-group';
      let iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
      let iconClass = 'design-icon';
      let title = 'تصاميم السوشيال ميديا الطبية والصور';
      let subtitle = 'جميع التصاميم والصور معروضة جنباً إلى جنب';
      let badgeClass = 'badge-cyan';
      let unit = 'تصميم';

      if (currentFilter === 'audio') {
        groupClass = 'audio-group';
        iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>';
        iconClass = 'audio-icon';
        title = 'التعليق الصوتي (Voice Over)';
        subtitle = 'تسجيلات ونماذج صوتية احترافية مع مشغل صوتي مدمج';
        badgeClass = 'badge-emerald';
        unit = 'تسجيل صوتي';
      } else if (currentFilter === 'video') {
        groupClass = 'videos-group';
        iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect width="14" height="14" x="1" y="5" rx="2" ry="2"></rect></svg>';
        iconClass = 'video-icon';
        title = 'فيديوهات الذكاء الاصطناعي والمونتاج';
        subtitle = 'جميع الفيديوهات معروضة جنباً إلى جنب';
        badgeClass = 'badge-purple';
        unit = 'فيديو';
      }

      if (currentFilter === 'video' || currentFilter === 'cartoons') {
        portfolioGrid.innerHTML = '';
        if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        return;
      }

      const visibleItems = filtered.filter((p) => !isCartoonItem(p) && !(p.type === 'video' && !p.id.startsWith('yt-vid-'))).slice(0, visibleLimit);

      portfolioGrid.innerHTML = `
        <section class="portfolio-group-section ${groupClass}">
          <div class="portfolio-group-header">
            <div class="group-header-info">
              <div class="group-icon-box ${iconClass}">
                ${iconHtml}
              </div>
              <div>
                <h3 class="group-title">${title}</h3>
                <span class="group-subtitle">${subtitle}</span>
              </div>
            </div>
            <span class="group-count-badge ${badgeClass}">${totalFiltered} ${unit}</span>
          </div>
          <div class="portfolio-subgrid ${groupClass.replace('-group', '-subgrid')}">
            ${visibleItems.map((item) => createProjectCardHtml(item)).join('')}
          </div>
        </section>
      `;

      attachCardEvents();

      if (loadMoreContainer) {
        if (visibleLimit < totalFiltered) {
          loadMoreContainer.style.display = 'flex';
          const remaining = totalFiltered - visibleLimit;
          if (loadMoreCountText) {
            loadMoreCountText.textContent = `تم عرض ${visibleItems.length} من أصل ${totalFiltered} عمل (متبقي ${remaining})`;
          }
        } else {
          loadMoreContainer.style.display = 'none';
        }
      }
    }
  }

  /* --------------------------------------------------------------------------
     إدارة مشغل مقاطع التعليق الصوتي (Voice Over Audio Player)
     -------------------------------------------------------------------------- */
  let currentPlayingAudioId = null;
  let activeAudioElement = null;
  let activeAudioInterval = null;
  let webAudioCtx = null;
  let webAudioOscillators = [];

  function stopAllAudios() {
    if (activeAudioElement) {
      try {
        activeAudioElement.pause();
        activeAudioElement.currentTime = 0;
      } catch (e) {}
      activeAudioElement = null;
    }
    if (webAudioOscillators.length > 0) {
      try {
        webAudioOscillators.forEach((o) => {
          try { o.stop(); } catch (e) {}
        });
      } catch (e) {}
      webAudioOscillators = [];
    }
    if (activeAudioInterval) {
      clearInterval(activeAudioInterval);
      activeAudioInterval = null;
    }
    document.querySelectorAll('.audio-ctrl-btn.playing').forEach((btn) => {
      btn.classList.remove('playing');
      const iconPlay = btn.querySelector('.icon-play');
      const iconPause = btn.querySelector('.icon-pause');
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    });
    document.querySelectorAll('.audio-waves-anim.active').forEach((w) => {
      w.classList.remove('active');
    });
    currentPlayingAudioId = null;
  }

  function playWebAudioDemoTone(projectId, onProgress, onEnd) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return false;
      if (!webAudioCtx) webAudioCtx = new AudioCtx();
      if (webAudioCtx.state === 'suspended') {
        webAudioCtx.resume();
      }

      const duration = 12;
      let elapsed = 0;
      const notes = [261.63, 329.63, 392.00, 523.25, 440.00, 392.00, 329.63, 261.63];

      const osc = webAudioCtx.createOscillator();
      const gain = webAudioCtx.createGain();
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.12, webAudioCtx.currentTime);

      osc.connect(gain);
      gain.connect(webAudioCtx.destination);
      osc.start();
      webAudioOscillators.push(osc);

      activeAudioInterval = setInterval(() => {
        elapsed += 0.25;
        const noteIdx = Math.floor((elapsed * 1.5) % notes.length);
        osc.frequency.setValueAtTime(notes[noteIdx], webAudioCtx.currentTime);

        if (onProgress) {
          onProgress(elapsed, duration);
        }

        if (elapsed >= duration) {
          stopAllAudios();
          if (onEnd) onEnd();
        }
      }, 250);

      return true;
    } catch (e) {
      return false;
    }
  }

  function toggleAudioPlay(projectId) {
    const project = cachedAllProjects.find((p) => p.id === projectId);
    if (!project) return;

    const playBtn = document.querySelector(`.btn-play-pause[data-play-id="${projectId}"]`);
    const wavesEl = document.getElementById(`waves_${projectId}`);
    const curTimeEl = document.getElementById(`curTime_${projectId}`);
    const totTimeEl = document.getElementById(`totTime_${projectId}`);
    const seekFillEl = document.getElementById(`seekFill_${projectId}`);

    if (currentPlayingAudioId === projectId) {
      stopAllAudios();
      return;
    }

    stopAllAudios();
    currentPlayingAudioId = projectId;

    if (playBtn) {
      playBtn.classList.add('playing');
      const iconPlay = playBtn.querySelector('.icon-play');
      const iconPause = playBtn.querySelector('.icon-pause');
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
    if (wavesEl) wavesEl.classList.add('active');

    const audioUrl = getAudioUrl(project);

    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }

    if (audioUrl) {
      const audio = new Audio(audioUrl);
      activeAudioElement = audio;

      audio.addEventListener('loadedmetadata', () => {
        if (totTimeEl && !isNaN(audio.duration)) {
          totTimeEl.textContent = formatTime(audio.duration);
        }
      });

      audio.addEventListener('timeupdate', () => {
        if (!isNaN(audio.duration) && audio.duration > 0) {
          const pct = (audio.currentTime / audio.duration) * 100;
          if (seekFillEl) seekFillEl.style.width = pct + '%';
          if (curTimeEl) curTimeEl.textContent = formatTime(audio.currentTime);
        }
      });

      audio.addEventListener('ended', () => {
        stopAllAudios();
        if (seekFillEl) seekFillEl.style.width = '0%';
        if (curTimeEl) curTimeEl.textContent = '00:00';
      });

      audio.play().catch((err) => {
        console.warn('تعذر تشغيل الصوت الأصلي، تشغيل النغمة التوضيحية:', err);
        startDemo();
      });
    } else {
      startDemo();
    }

    function startDemo() {
      const totalSec = 12;
      if (totTimeEl) totTimeEl.textContent = formatTime(totalSec);

      playWebAudioDemoTone(
        projectId,
        (current, total) => {
          if (seekFillEl) seekFillEl.style.width = (current / total) * 100 + '%';
          if (curTimeEl) curTimeEl.textContent = formatTime(current);
        },
        () => {
          if (seekFillEl) seekFillEl.style.width = '0%';
          if (curTimeEl) curTimeEl.textContent = '00:00';
        }
      );
    }
  }

  function createProjectCardHtml(item) {
    const isAudio = item.type === 'audio';
    const isCartoon = isCartoonItem(item);
    const isVideo = item.type === 'video';
    const isVertical = item.aspectRatio === '9:16';
    const mediaWrapClass = isVertical ? 'card-media-wrapper vertical-video' : 'card-media-wrapper';

    let badgeClass = 'badge badge-cyan';
    let badgeText = 'تصميم';
    if (isAudio) {
      badgeClass = 'badge badge-emerald';
      badgeText = 'تعليق صوتي';
    } else if (isCartoon) {
      badgeClass = 'badge badge-cartoon';
      badgeText = 'نصائح كرتون';
    } else if (isVideo) {
      badgeClass = 'badge badge-purple';
      badgeText = 'فيديو';
    }

    const isVideoAlbum = isVideo && (item.isAlbum || (Array.isArray(item.videos) && item.videos.length > 1));
    const isAudioAlbum = isAudio && (item.isAlbum || (Array.isArray(item.audios) && item.audios.length > 1));
    const isImageAlbum = !isVideo && !isAudio && (item.isAlbum || (Array.isArray(item.images) && item.images.length > 1));
    const isAlbum = isVideoAlbum || isImageAlbum || isAudioAlbum;
    const albumCount = isVideoAlbum 
      ? (item.videos ? item.videos.length : 1) 
      : (isAudioAlbum ? (item.audios ? item.audios.length : 1) : (isImageAlbum ? (item.images ? item.images.length : 1) : 1));

    const mediaSrc = getMediaUrl(item);

    const controlsHtml = !item.isDefault ? `
      <div class="card-controls">
        <button type="button" class="btn-card-ctrl edit" data-id="${item.id}" title="تعديل العمل" aria-label="تعديل العمل">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button type="button" class="btn-card-ctrl delete" data-id="${item.id}" title="حذف العمل" aria-label="حذف العمل">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    ` : '';

    // بطاقة التعليق الصوتي (Voice Over)
    if (isAudio) {
      const audioUrl = getAudioUrl(item);
      return `
        <article class="portfolio-card card-audio" data-id="${item.id}" data-type="audio">
          <div class="${mediaWrapClass}" data-action="toggle-audio" data-id="${item.id}">
            <img src="${escapeHtml(mediaSrc || 'assets/images/audio-thumb-voice.svg')}" alt="${escapeHtml(item.title)}" class="card-media-img" loading="lazy">
            <div class="card-badge-top">
              <span class="${badgeClass}">${badgeText}</span>
              ${isAlbum ? `<span class="badge badge-album">ألبوم صوتي (${albumCount} مقاطع)</span>` : ''}
              ${!item.isDefault ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); margin-right: 0.35rem;">محفوظ من جهازك</span>' : ''}
            </div>

            <div class="media-play-indicator" style="background: rgba(16, 185, 129, 0.9); box-shadow: 0 0 25px rgba(16, 185, 129, 0.7);">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
            </div>
          </div>

          <div class="card-body">
            <div class="card-category-label">
              ${escapeHtml(item.category || (isAlbum ? `ألبوم تعليق صوتي (${albumCount} مقاطع)` : 'تعليق صوتي / Voice Over'))}
            </div>
            <h3 class="card-title">${escapeHtml(item.title)}</h3>
            ${item.desc ? `<p class="card-desc">${escapeHtml(item.desc)}</p>` : ''}

            <!-- مشغل الصوت التفاعلي المدمج -->
            <div class="audio-player-panel" data-audio-project-id="${item.id}">
              <div class="audio-player-controls">
                <button type="button" class="audio-ctrl-btn btn-play-pause" data-play-id="${item.id}" title="تشغيل / إيقاف الصوت" aria-label="تشغيل">
                  <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                </button>
                <div class="audio-track-info">
                  <div class="audio-time-row">
                    <span class="audio-current-time" id="curTime_${item.id}">00:00</span>
                    <span class="audio-waves-anim" id="waves_${item.id}">
                      <span></span><span></span><span></span><span></span><span></span>
                    </span>
                    <span class="audio-total-time" id="totTime_${item.id}">${item.audioDuration || '01:15'}</span>
                  </div>
                  <div class="audio-seek-bar-track" data-seek-id="${item.id}">
                    <div class="audio-seek-bar-fill" id="seekFill_${item.id}"></div>
                  </div>
                </div>
                ${audioUrl ? `
                  <a href="${audioUrl}" download="${escapeHtml(item.title)}.mp3" class="audio-dl-btn" title="تحميل الملف الصوتي لجهازك" target="_blank" rel="noopener">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  </a>
                ` : ''}
              </div>
            </div>

            <div class="card-footer" style="margin-top: 0.75rem;">
              <button type="button" class="card-view-btn" data-action="toggle-audio" data-id="${item.id}">
                <span>استماع للتعليق الصوتي</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </button>
              ${controlsHtml}
            </div>
          </div>
        </article>
      `;
    }

    // بطاقة الفيديو أو التصميم
    return `
      <article class="portfolio-card ${isAlbum ? 'portfolio-card-album' : ''} ${isVideoAlbum ? 'card-video-album' : ''} ${isCartoon ? 'card-cartoon' : ''}" data-id="${item.id}" data-type="${item.type}">
        
        <div class="${mediaWrapClass}" data-action="open-media" data-id="${item.id}">
          <img src="${escapeHtml(mediaSrc)}" alt="${escapeHtml(item.title)}" class="card-media-img" loading="lazy">
          
          <div class="card-badge-top">
            <span class="${badgeClass}">${badgeText}</span>
            ${isAlbum ? `
              <span class="badge ${isVideoAlbum ? 'badge-purple' : 'badge-album'}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  ${isVideoAlbum ? '<polygon points="5 3 19 12 5 21 5 3"></polygon>' : '<rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'}
                </svg>
                ${isVideoAlbum ? `ألبوم فيديو (${albumCount} مقاطع)` : `ألبوم (${albumCount} صور)`}
              </span>
            ` : ''}
            ${!item.isDefault ? '<span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); margin-right: 0.35rem;">محفوظ</span>' : ''}
          </div>

          ${isAlbum ? `
            <div class="card-album-indicator ${isVideoAlbum ? 'video-indicator' : ''}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                ${isVideoAlbum ? '<polygon points="5 3 19 12 5 21 5 3"></polygon>' : '<rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'}
              </svg>
              <span>${albumCount} ${isVideoAlbum ? 'فيديوهات (انقر للتشغيل)' : 'صور'}</span>
            </div>
          ` : ''}

          ${isVideo ? `
            <div class="media-play-indicator" title="تشغيل الفيديو فوراً">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
          ` : `
            <div class="card-media-overlay">
              <span class="btn btn-secondary btn-sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                <span>${isAlbum ? `عرض الألبوم (${albumCount} صور جنب بعض)` : 'عرض بالحجم الكامل'}</span>
              </span>
            </div>
          `}

          ${isAlbum ? `
            <div class="album-hover-peek ${isVideoAlbum ? 'video-peek' : ''}" aria-label="${isVideoAlbum ? 'معاينة الفيديوهات وتشغيلها فوراً' : 'معاينة التصاميم'}">
              <div class="peek-label">
                <span class="peek-dot"></span>
                <span>${isVideoAlbum ? `انقر لتشغيل الفيديو • ${albumCount} مقاطع` : `انقر للدخول للمسرح ثلاثي الأبعاد • ${albumCount} تصاميم`}</span>
              </div>
              <div class="peek-cards-row">
                ${(isVideoAlbum ? (item.videos || []) : (item.images || [])).slice(0, 4).map((subItem, i) => {
                  const src = isVideoAlbum 
                    ? (subItem.thumbUrl || item.thumbUrl || 'assets/images/video-thumb-1.svg') 
                    : getAlbumItemUrl(item, subItem, i);
                  const subTitle = isVideoAlbum 
                    ? (subItem.title || `فيديو ${i + 1}`) 
                    : (subItem.name ? subItem.name.replace(/\.[^/.]+$/, '') : `تصميم ${i + 1}`);
                  return `
                    <div class="peek-card ${isVideoAlbum ? 'peek-video-card' : ''}" data-video-idx="${i}" style="--peek-i: ${i};" title="${escapeHtml(subTitle)}">
                      <img src="${escapeHtml(src)}" alt="${escapeHtml(subTitle)}" loading="lazy">
                      ${isVideoAlbum ? `
                        <div class="peek-play-badge">
                          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                        </div>
                      ` : ''}
                      <span class="peek-number">0${i + 1}</span>
                    </div>
                  `;
                }).join('')}
              </div>
              <div class="peek-footer-hint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
                  ${isVideoAlbum ? '<polygon points="5 3 19 12 5 21 5 3"></polygon>' : '<rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="7" x="3" y="14" rx="1"></rect>'}
                </svg>
                <span>${isVideoAlbum ? 'اضغط لتشغيل أي فيديو فوراً' : 'اضغط للمشاهدة في مسرح الهولوجرام'}</span>
              </div>
            </div>
          ` : ''}
        </div>

        <div class="card-body">
          <div class="card-category-label">
            ${escapeHtml(item.category || (isVideoAlbum ? `ألبوم فيديو سينمائي (${albumCount} فيديوهات)` : (isVideo ? 'صناعة فيديو بالذكاء الاصطناعي' : (isAlbum ? `ألبوم صور (${albumCount} صور)` : 'تصميم سوشيال ميديا طبي'))))}
          </div>
          <h3 class="card-title">${escapeHtml(item.title)}</h3>
          ${item.desc ? `<p class="card-desc">${escapeHtml(item.desc)}</p>` : ''}
          
          <div class="card-footer">
            <button type="button" class="card-view-btn" data-action="open-media" data-id="${item.id}">
              <span>${isVideoAlbum ? `تشغيل الفيديوهات (${albumCount} مقاطع)` : (isVideo ? 'تشغيل الفيديو' : (isAlbum ? `عرض هولوجرامي (${albumCount} صور جنب بعض)` : 'مشاهدة التصميم'))}</span>
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
            ${controlsHtml}
          </div>
        </div>

      </article>
    `;
  }

  function attachCardEvents() {
    // ربط أزرار تشغيل الصوت
    const playAudioBtns = portfolioGrid.querySelectorAll('.btn-play-pause');
    playAudioBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-play-id');
        if (id) toggleAudioPlay(id);
      });
    });

    // ربط شريط التمرير للصوت
    const seekBars = portfolioGrid.querySelectorAll('.audio-seek-bar-track');
    seekBars.forEach((bar) => {
      bar.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = bar.getAttribute('data-seek-id');
        if (!id) return;
        const rect = bar.getBoundingClientRect();
        const clickPos = (e.clientX - rect.left) / rect.width;
        if (activeAudioElement && currentPlayingAudioId === id && !isNaN(activeAudioElement.duration)) {
          activeAudioElement.currentTime = clickPos * activeAudioElement.duration;
        }
      });
    });

    // ربط بطاقات الصوت عند النقر
    const audioCardViews = portfolioGrid.querySelectorAll('[data-action="toggle-audio"]');
    audioCardViews.forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = el.getAttribute('data-id');
        if (id) toggleAudioPlay(id);
      });
    });

    // إمكانية النقر من الخارج على كامل بطاقة العمل
    const cards = portfolioGrid.querySelectorAll('.portfolio-card');
    cards.forEach((card) => {
      card.addEventListener('click', (e) => {
        // تجاهل النقر إذا كان على عناصر التحكم بالصوت أو التعديل
        if (e.target.closest('.card-controls') || e.target.closest('.btn-card-ctrl') || e.target.closest('.audio-player-panel')) return;

        const id = card.getAttribute('data-id');
        const project = cachedAllProjects.find((p) => p.id === id);
        if (!project) return;

        if (project.type === 'audio') {
          toggleAudioPlay(project.id);
          return;
        }

        const isVideo = project.type === 'video' || isCartoonItem(project);
        if (isVideo) {
          const peekCard = e.target.closest('.peek-card');
          let videoIdx = 0;
          if (peekCard && peekCard.hasAttribute('data-video-idx')) {
            videoIdx = parseInt(peekCard.getAttribute('data-video-idx'), 10) || 0;
          }
          openVideoModal(project, videoIdx);
          return;
        }

        const isAlbum = !!project.isAlbum || 
          (Array.isArray(project.images) && project.images.length > 1);

        if (isAlbum) {
          openHologramViewer(project);
        } else {
          openLightbox(project);
        }
      });
    });

    const editBtns = portfolioGrid.querySelectorAll('.btn-card-ctrl.edit');
    editBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        openEditProjectModal(id);
      });
    });

    const deleteBtns = portfolioGrid.querySelectorAll('.btn-card-ctrl.delete');
    deleteBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        confirmDeleteProject(id);
      });
    });
  }

  function initPortfolioFilters() {
    filterTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        filterTabBtns.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        currentFilter = btn.getAttribute('data-filter') || 'all';
        visibleLimit = BASE_PAGE_SIZE;
        renderPortfolio();
      });
    });

    if (btnLoadMore) {
      btnLoadMore.addEventListener('click', () => {
        visibleLimit += BASE_PAGE_SIZE;
        renderPortfolio();
        showToast('تم تحميل المزيد من الأعمال');
      });
    }

    if (btnLoadAll) {
      btnLoadAll.addEventListener('click', () => {
        visibleLimit = cachedAllProjects.length;
        renderPortfolio();
        showToast(`تم عرض جميع الأعمال (${cachedAllProjects.length} عمل)`);
      });
    }
  }

  /* --------------------------------------------------------------------------
     11. منطقة السحب والإفلات والتجميع التراكمي للملفات
     -------------------------------------------------------------------------- */
  function initDropzone() {
    if (!dropzoneArea || !projectFileInput) return;

    dropzoneArea.addEventListener('click', () => {
      projectFileInput.click();
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzoneArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzoneArea.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzoneArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzoneArea.classList.remove('dragover');
      });
    });

    dropzoneArea.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleSelectedBatchFiles(files);
      }
    });

    projectFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleSelectedBatchFiles(e.target.files);
      }
    });
  }

  // تجميع الملفات تراكمياً عند اختيارها وتوليد معاينات سريعة للألبوم
  async function handleSelectedBatchFiles(fileList) {
    const newFiles = Array.from(fileList);
    const isDesign = projectFormType.value === 'design';

    for (const f of newFiles) {
      const exists = selectedBatchFiles.some(
        (existing) => existing.name === f.name && existing.size === f.size && existing.lastModified === f.lastModified
      );
      if (!exists) {
        selectedBatchFiles.push(f);
        // توليد معاينة فورية لصور وفيديوهات وتسجيلات الألبوم
        if (f.type.startsWith('image/')) {
          try {
            const thumbUrl = await generateThumbnail(f);
            batchThumbnailsCache.push({ name: f.name, size: f.size, thumbUrl: thumbUrl });
          } catch (e) {
            batchThumbnailsCache.push({ name: f.name, size: f.size, thumbUrl: null });
          }
        } else if (f.type.startsWith('video/')) {
          try {
            const thumbUrl = await generateVideoThumbnail(f);
            batchThumbnailsCache.push({ name: f.name, size: f.size, thumbUrl: thumbUrl });
          } catch (e) {
            batchThumbnailsCache.push({ name: f.name, size: f.size, thumbUrl: 'assets/images/video-thumb-1.svg' });
          }
        } else if (f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
          // ملفات التعليق الصوتي
          batchThumbnailsCache.push({ name: f.name, size: f.size, thumbUrl: 'assets/images/audio-thumb-voice.svg' });
        }
      }
    }

    if (selectedCoverIndex >= selectedBatchFiles.length) {
      selectedCoverIndex = 0;
    }

    updateBatchUI();
  }

  function removeFileFromBatch(index) {
    if (index >= 0 && index < selectedBatchFiles.length) {
      const removed = selectedBatchFiles.splice(index, 1)[0];
      batchThumbnailsCache = batchThumbnailsCache.filter((t) => t.name !== removed.name || t.size !== removed.size);
      if (selectedCoverIndex >= selectedBatchFiles.length) {
        selectedCoverIndex = Math.max(0, selectedBatchFiles.length - 1);
      }
      updateBatchUI();
    }
  }

  function clearBatchSelection() {
    selectedBatchFiles = [];
    batchThumbnailsCache = [];
    selectedCoverIndex = 0;
    if (projectFileInput) projectFileInput.value = '';
    updateBatchUI();
  }

  function updateBatchUI() {
    const count = selectedBatchFiles.length;
    const isDesign = projectFormType.value === 'design';
    const isAudio = projectFormType.value === 'audio';

    if (count === 0) {
      if (dropzoneTitle) {
        dropzoneTitle.textContent = 'اسحب وأفلت الملفات هنا أو اضغط للاختيار من جهازك';
      }
      if (batchPreviewStrip) {
        batchPreviewStrip.style.display = 'none';
        batchPreviewStrip.innerHTML = '';
      }
      if (modalAlbumPreviewGrid) {
        modalAlbumPreviewGrid.style.display = 'none';
        modalAlbumPreviewGrid.innerHTML = '';
      }
      return;
    }

    // إذا كنا في وضع التعليق الصوتي (Voice Over)
    if (isAudio) {
      if (batchPreviewStrip) batchPreviewStrip.style.display = 'none';

      if (dropzoneTitle) {
        if (count === 1) {
          dropzoneTitle.textContent = `تم اختيار ملف صوتي 1 (انقر لاختيار المزيد أو حفظه)`;
        } else {
          dropzoneTitle.textContent = `تم تجميع ${count} ملفات تعليق صوتي من جهازك (انقر لإضافة المزيد)`;
        }
      }

      if (modalAlbumPreviewGrid) {
        modalAlbumPreviewGrid.style.display = 'grid';
        modalAlbumPreviewGrid.innerHTML = `
          <div style="grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; padding: 0.2rem 0.4rem; font-size: 0.85rem; color: #10b981; font-weight: 700;">
            <span>ملفات التعليق الصوتي المحددة (${count} مقطع - يتم حفظها محلياً بجهازك):</span>
            <button type="button" class="batch-clear-btn" id="btnAlbumClear">مسح الكل</button>
          </div>
          ${selectedBatchFiles.map((f, i) => {
            const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
            return `
              <div class="modal-album-item modal-audio-item" data-index="${i}" title="${escapeHtml(f.name)}" style="background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.35); flex-direction: column; align-items: center; justify-content: center; padding: 0.75rem 0.5rem; text-align: center; border-radius: 12px; border-width: 1px; border-style: solid;">
                <div style="width: 38px; height: 38px; border-radius: 50%; background: rgba(16, 185, 129, 0.2); display: flex; align-items: center; justify-content: center; color: #10b981; margin-bottom: 0.4rem;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 20px; height: 20px;"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>
                </div>
                <div style="font-size: 0.78rem; font-weight: 700; color: #fff; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.2rem;">
                  ${escapeHtml(f.name)}
                </div>
                <div style="font-size: 0.7rem; color: #10b981; margin-bottom: 0.4rem;">
                  ${sizeMb} MB
                </div>
                <div class="modal-album-item-actions" style="position: static; opacity: 1; transform: none; background: transparent; padding: 0;">
                  <button type="button" class="modal-remove-item-btn" data-remove-idx="${i}">حذف</button>
                </div>
              </div>
            `;
          }).join('')}
        `;

        // ربط أزرار الحذف
        const removeBtns = modalAlbumPreviewGrid.querySelectorAll('[data-remove-idx]');
        removeBtns.forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-remove-idx'), 10);
            if (!isNaN(idx)) {
              removeFileFromBatch(idx);
            }
          });
        });

        // زر مسح الكل
        const clearBtn = document.getElementById('btnAlbumClear');
        if (clearBtn) {
          clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearBatchSelection();
          });
        }
      }

    // إذا كنا في وضع التصاميم / الألبومات (صور)
    } else if (isDesign) {
      if (batchPreviewStrip) batchPreviewStrip.style.display = 'none';

      if (dropzoneTitle) {
        if (count === 1) {
          dropzoneTitle.textContent = `تم اختيار صورة واحدة (انقر لإضافة المزيد من صور الألبوم)`;
        } else {
          dropzoneTitle.textContent = `تم تجميع ${count} صور في ألبوم واحد موحد (انقر لإضافة المزيد)`;
        }
      }

      if (modalAlbumPreviewGrid) {
        modalAlbumPreviewGrid.style.display = 'grid';
        modalAlbumPreviewGrid.innerHTML = `
          <div style="grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; padding: 0.2rem 0.4rem; font-size: 0.85rem; color: var(--accent-cyan); font-weight: 700;">
            <span>معاينة صور الألبوم (${count} صور - صورة الغلاف محددة بإطار مميز):</span>
            <button type="button" class="batch-clear-btn" id="btnAlbumClear">مسح الكل</button>
          </div>
          ${selectedBatchFiles.map((f, i) => {
            const cached = batchThumbnailsCache.find((t) => t.name === f.name && t.size === f.size);
            const thumbSrc = cached && cached.thumbUrl ? cached.thumbUrl : 'assets/images/medical-design-1.svg';
            const isCover = i === selectedCoverIndex;
            return `
              <div class="modal-album-item ${isCover ? 'is-cover' : ''}" data-index="${i}" title="${escapeHtml(f.name)}">
                <img src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(f.name)}" loading="lazy">
                ${isCover ? '<span class="modal-album-item-cover-tag">صورة الغلاف</span>' : ''}
                <div class="modal-album-item-actions">
                  ${!isCover ? `<button type="button" class="modal-set-cover-btn" data-cover-idx="${i}">تعيين كغلاف</button>` : '<span style="font-size: 0.72rem; color: #fff; font-weight: 700;">الغلاف الحالي</span>'}
                  <button type="button" class="modal-remove-item-btn" data-remove-idx="${i}">حذف</button>
                </div>
              </div>
            `;
          }).join('')}
        `;

        // ربط أزرار تعيين الغلاف
        const setCoverBtns = modalAlbumPreviewGrid.querySelectorAll('[data-cover-idx]');
        setCoverBtns.forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-cover-idx'), 10);
            if (!isNaN(idx)) {
              selectedCoverIndex = idx;
              updateBatchUI();
              showToast('تم تعيين صورة الغلاف');
            }
          });
        });

        // ربط أزرار الحذف
        const removeBtns = modalAlbumPreviewGrid.querySelectorAll('[data-remove-idx]');
        removeBtns.forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-remove-idx'), 10);
            if (!isNaN(idx)) {
              removeFileFromBatch(idx);
            }
          });
        });

        // زر مسح الكل
        const clearBtn = document.getElementById('btnAlbumClear');
        if (clearBtn) {
          clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearBatchSelection();
          });
        }
      }

    } else {
      // وضع الفيديو (ألبوم فيديوهات هولوجرامية جنباً إلى جنب)
      if (batchPreviewStrip) batchPreviewStrip.style.display = 'none';

      if (dropzoneTitle) {
        if (count === 1) {
          dropzoneTitle.textContent = `تم اختيار فيديو 1 (انقر لاختيار المزيد لإنشاء ألبوم موحد)`;
        } else {
          dropzoneTitle.textContent = `تم تجميع ${count} ملفات فيديو في ألبوم هولوجرام موحد (انقر لإضافة المزيد)`;
        }
      }

      if (modalAlbumPreviewGrid) {
        modalAlbumPreviewGrid.style.display = 'grid';
        modalAlbumPreviewGrid.innerHTML = `
          <div style="grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; padding: 0.2rem 0.4rem; font-size: 0.85rem; color: #c084fc; font-weight: 700;">
            <span>معاينة فيديوهات الألبوم (${count} فيديو - فيديو الغلاف محدد بإطار بنفسجي):</span>
            <button type="button" class="batch-clear-btn" id="btnAlbumClear">مسح الكل</button>
          </div>
          ${selectedBatchFiles.map((f, i) => {
            const cached = batchThumbnailsCache.find((t) => t.name === f.name && t.size === f.size);
            const thumbSrc = cached && cached.thumbUrl ? cached.thumbUrl : 'assets/images/video-thumb-1.svg';
            const isCover = i === selectedCoverIndex;
            return `
              <div class="modal-album-item modal-video-item ${isCover ? 'is-cover' : ''}" data-index="${i}" title="${escapeHtml(f.name)}">
                <img src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(f.name)}" loading="lazy">
                ${isCover ? '<span class="modal-album-item-cover-tag" style="background: rgba(168, 85, 247, 0.9);">فيديو الغلاف</span>' : ''}
                <div class="modal-album-item-actions">
                  ${!isCover ? `<button type="button" class="modal-set-cover-btn" data-cover-idx="${i}">تعيين كغلاف</button>` : '<span style="font-size: 0.72rem; color: #fff; font-weight: 700;">الغلاف الحالي</span>'}
                  <button type="button" class="modal-remove-item-btn" data-remove-idx="${i}">حذف</button>
                </div>
              </div>
            `;
          }).join('')}
        `;

        // ربط أزرار تعيين الغلاف
        const setCoverBtns = modalAlbumPreviewGrid.querySelectorAll('[data-cover-idx]');
        setCoverBtns.forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-cover-idx'), 10);
            if (!isNaN(idx)) {
              selectedCoverIndex = idx;
              updateBatchUI();
              showToast('تم تعيين فيديو الغلاف');
            }
          });
        });

        // ربط أزرار الحذف
        const removeBtns = modalAlbumPreviewGrid.querySelectorAll('[data-remove-idx]');
        removeBtns.forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-remove-idx'), 10);
            if (!isNaN(idx)) {
              removeFileFromBatch(idx);
            }
          });
        });

        // زر مسح الكل
        const clearBtn = document.getElementById('btnAlbumClear');
        if (clearBtn) {
          clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearBatchSelection();
          });
        }
      }
    }

    if (!projectTitleInput.value.trim() && selectedBatchFiles[0]) {
      if (isAudio && count > 1) {
        projectTitleInput.value = `ألبوم تعليق صوتي (${count} تسجيلات)`;
      } else if (isDesign && count > 1) {
        projectTitleInput.value = `ألبوم تصاميم (${count} صور)`;
      } else if (!isDesign && !isAudio && count > 1) {
        projectTitleInput.value = `ألبوم فيديوهات بالذكاء الاصطناعي (${count} فيديوهات)`;
      } else {
        const cleanName = selectedBatchFiles[0].name.replace(/\.[^/.]+$/, '');
        projectTitleInput.value = cleanName;
      }
    }
  }

  function resetDropzoneUI() {
    selectedBatchFiles = [];
    batchThumbnailsCache = [];
    selectedCoverIndex = 0;
    if (projectFileInput) projectFileInput.value = '';
    if (dropzoneTitle) {
      dropzoneTitle.textContent = 'اسحب وأفلت الملفات هنا أو اضغط للاختيار من جهازك';
    }
    if (batchPreviewStrip) {
      batchPreviewStrip.style.display = 'none';
      batchPreviewStrip.innerHTML = '';
    }
    if (modalAlbumPreviewGrid) {
      modalAlbumPreviewGrid.style.display = 'none';
      modalAlbumPreviewGrid.innerHTML = '';
    }
    if (batchProgressWrapper) {
      batchProgressWrapper.classList.remove('active');
    }
  }

  /* --------------------------------------------------------------------------
     12. نافذة إضافة وتعديل المشاريع (الحفظ التراكمي الدائم)
     -------------------------------------------------------------------------- */
  function openAddProjectModal(type) {
    if (!projectModalOverlay || !projectForm) return;

    projectForm.reset();
    resetDropzoneUI();
    projectEditId.value = '';
    projectFormType.value = type;

    // تحديث الأزرار في محول نوع العمل
    if (modalTypeSwitcher) {
      const switchBtns = modalTypeSwitcher.querySelectorAll('.type-switch-btn');
      switchBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-switch-type') === type);
      });
    }

    const { imagesCount, videosCount, cartoonsCount, audiosCount } = calculateMediaCounts();

    if (type === 'audio') {
      const remainingAudios = Math.max(0, CAPACITY_LIMIT_AUDIOS - (audiosCount || 0));
      projectModalHeading.textContent = '+ إضافة تعليق صوتي من جهازك (سعة حتى 50 تسجيل)';
      mediaUploadLabel.textContent = 'ملفات التعليق الصوتي من جهازك (MP3, WAV, M4A, OGG) *';
      projectFileInput.accept = 'audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac';
      projectUrlInput.placeholder = 'مثال: رابط ملف صوتي خارجي أو تسجيل سحابي (اختياري)';
      videoAspectGroup.style.display = 'none';

      if (modalSavedCountText) {
        modalSavedCountText.textContent = `سعة التعليق الصوتي: تم استخدام (${audiosCount || 0}) من أصل 50 تسجيل (متبقي سعة لـ ${remainingAudios} تسجيل جديد). يتم تخزين الملفات الصوتية بمحرك IndexedDB مع مشغل صوتي تفاعلي كامل.`;
      }
    } else if (type === 'cartoon') {
      const remainingCartoons = Math.max(0, CAPACITY_LIMIT_CARTOONS - (cartoonsCount || 0));
      projectModalHeading.textContent = '+ إضافة فيديو نصائح كرتون (سعة حتى 50 فيديو)';
      mediaUploadLabel.textContent = 'ملفات فيديو نصائح الكرتون (MP4, WebM, MOV) *';
      projectFileInput.accept = 'video/*,image/*';
      projectUrlInput.placeholder = 'مثال: https://youtu.be/... أو رابط فيديو كرتون مباشر';
      videoAspectGroup.style.display = 'block';

      if (modalSavedCountText) {
        modalSavedCountText.textContent = `سعة نصائح الكرتون: تم استخدام (${cartoonsCount || 0}) من أصل 50 فيديو (متبقي سعة لـ ${remainingCartoons} فيديو كرتوني جديد). يتم تخزين مقاطع الكرتون محلياً مع دعم التشغيل السلس.`;
      }
    } else if (type === 'video') {
      const remainingVideos = Math.max(0, CAPACITY_LIMIT_VIDEOS - (videosCount || 0));
      projectModalHeading.textContent = '+ إضافة فيديو / ألبوم فيديوهات (سعة حتى 50 فيديو)';
      mediaUploadLabel.textContent = 'ملفات الفيديو (يمكنك اختيار عدة فيديوهات لتظهر في ألبوم هولوجرام موحد) *';
      projectFileInput.accept = 'video/*,image/*';
      projectUrlInput.placeholder = 'مثال: https://youtu.be/... أو رابط فيديو مباشر';
      videoAspectGroup.style.display = 'block';

      if (modalSavedCountText) {
        modalSavedCountText.textContent = `سعة الفيديوهات: تم استخدام (${videosCount || 0}) من أصل 50 فيديو (متبقي سعة لـ ${remainingVideos} فيديو جديد). يتم استخراج البوستر تلقائياً وعرض الفيديوهات في مسرح هولوجرامي 3D.`;
      }
    } else {
      const remainingImages = Math.max(0, CAPACITY_LIMIT_IMAGES - imagesCount);
      projectModalHeading.textContent = '+ إضافة صور / ألبوم تصاميم (سعة حتى 200 صورة)';
      mediaUploadLabel.textContent = 'ملفات الصور (يمكنك اختيار عدة صور لتظهر كغلاف واحد وألبوم متكامل) *';
      projectFileInput.accept = 'image/*';
      projectUrlInput.placeholder = 'مثال: https://example.com/design.jpg';
      videoAspectGroup.style.display = 'none';

      if (modalSavedCountText) {
        modalSavedCountText.textContent = `سعة الصور والتصاميم: تم استخدام (${imagesCount}) من أصل 200 صورة (متبقي سعة لـ ${remainingImages} صورة جديدة). يتم تحسين الصور وتخزينها بأعلى دقة.`;
      }
    }

    projectModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
    projectTitleInput.focus();
  }

  function openEditProjectModal(id) {
    const project = cachedAllProjects.find((p) => p.id === id);
    if (!project || project.isDefault) return;

    resetDropzoneUI();
    projectEditId.value = project.id;
    projectFormType.value = project.type;
    projectTitleInput.value = project.title || '';
    projectCategoryInput.value = project.category || '';
    projectDescInput.value = project.desc || '';
    projectUrlInput.value = project.videoUrl || (typeof project.media === 'string' && project.media.startsWith('http') ? project.media : '');

    const isAudioAlbum = Array.isArray(project.audios) && project.audios.length > 1;
    const isImageAlbum = Array.isArray(project.images) && project.images.length > 1;
    const isVideoAlbum = Array.isArray(project.videos) && project.videos.length > 1;
    const isAlbum = isImageAlbum || isVideoAlbum || isAudioAlbum;
    const itemsCount = isVideoAlbum ? project.videos.length : (isAudioAlbum ? project.audios.length : (isImageAlbum ? project.images.length : 1));

    if (modalSavedCountText) {
      modalSavedCountText.textContent = isAlbum 
        ? `أنت الآن في وضع تعديل بيانات هذا الألبوم (يضم ${itemsCount} ${isVideoAlbum ? 'فيديوهات' : (isAudioAlbum ? 'تسجيلات' : 'صور')}). يمكنك تعديل العنوان والوصف والتصنيف.`
        : 'أنت الآن في وضع تعديل بيانات هذا العمل المحدد.';
    }

    if (project.type === 'audio') {
      projectModalHeading.textContent = isAlbum ? `تعديل ألبوم التعليق الصوتي (${itemsCount} مقاطع)` : 'تعديل تسجيل التعليق الصوتي';
      videoAspectGroup.style.display = 'none';
    } else if (project.type === 'video') {
      projectModalHeading.textContent = isAlbum ? `تعديل ألبوم الفيديوهات (${itemsCount} فيديوهات)` : 'تعديل مشروع الفيديو';
      videoAspectGroup.style.display = 'block';
      videoAspectSelect.value = project.aspectRatio || '16:9';
    } else {
      projectModalHeading.textContent = isAlbum ? `تعديل ألبوم التصاميم (${itemsCount} صور)` : 'تعديل مشروع التصميم';
      videoAspectGroup.style.display = 'none';
    }

    projectModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeProjectModal() {
    if (!projectModalOverlay) return;
    resetDropzoneUI();
    projectModalOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function initProjectModal() {
    if (btnAddAudio) {
      btnAddAudio.addEventListener('click', () => openAddProjectModal('audio'));
    }
    if (btnAddDesign) {
      btnAddDesign.addEventListener('click', () => openAddProjectModal('design'));
    }
    if (btnAddVideo) {
      btnAddVideo.addEventListener('click', () => openAddProjectModal('video'));
    }
    if (btnAddCartoon) {
      btnAddCartoon.addEventListener('click', () => openAddProjectModal('cartoon'));
    }

    if (modalTypeSwitcher) {
      const switchBtns = modalTypeSwitcher.querySelectorAll('.type-switch-btn');
      switchBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const targetType = btn.getAttribute('data-switch-type');
          if (targetType) {
            openAddProjectModal(targetType);
          }
        });
      });
    }

    if (projectModalCloseBtn) projectModalCloseBtn.addEventListener('click', closeProjectModal);
    if (projectModalCancelBtn) projectModalCancelBtn.addEventListener('click', closeProjectModal);

    projectModalOverlay.addEventListener('click', (e) => {
      if (e.target === projectModalOverlay) closeProjectModal();
    });

    if (projectForm) {
      projectForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const baseTitle = projectTitleInput.value.trim();
        const category = projectCategoryInput.value.trim();
        const desc = projectDescInput.value.trim();
        const urlInput = projectUrlInput.value.trim();
        const type = projectFormType.value;
        const editId = projectEditId.value;
        const aspectRatio = videoAspectSelect ? videoAspectSelect.value : '16:9';

        if (!baseTitle && selectedBatchFiles.length === 0 && !urlInput) {
          showToast('يرجى إدخال عنوان المشروع أو اختيار ملفات للرفع');
          return;
        }

        const now = Date.now();

        // 1. معالجة وحفظ ملفات التصاميم (تجميع الصور المتعددة في ألبوم واحد بغلاف موحد)
        if (type === 'design' && selectedBatchFiles.length > 0) {
          const totalFiles = selectedBatchFiles.length;

          if (batchProgressWrapper) {
            batchProgressWrapper.classList.add('active');
            if (batchProgressText) {
              batchProgressText.textContent = totalFiles > 1 
                ? `جارٍ تجميع وتخزين صور الألبوم (${totalFiles} صور)...` 
                : 'جارٍ معالجة وتخزين صورة التصميم...';
            }
          }

          const albumImages = [];

          for (let i = 0; i < totalFiles; i++) {
            const file = selectedBatchFiles[i];

            let cleanBlob = null;
            let thumbDataUrl = null;

            try {
              cleanBlob = await optimizeImageBlob(file, 2048, 0.88);
            } catch (bufErr) {
              try {
                const arrayBuf = await file.arrayBuffer();
                cleanBlob = new Blob([arrayBuf], { type: file.type });
              } catch (e2) {
                cleanBlob = file.slice(0, file.size, file.type || 'image/jpeg');
              }
            }

            // استخدام المعاينة السريعة المخزنة إن وجدت أو توليدها
            const cachedThumb = batchThumbnailsCache.find((t) => t.name === file.name && t.size === file.size);
            if (cachedThumb && cachedThumb.thumbUrl) {
              thumbDataUrl = cachedThumb.thumbUrl;
            } else {
              thumbDataUrl = await generateThumbnail(file);
            }

            albumImages.push({
              id: 'img_' + now + '_' + i,
              name: file.name,
              blob: cleanBlob,
              thumbUrl: thumbDataUrl
            });

            if (batchProgressFill && batchProgressPercent) {
              const percent = Math.round(((i + 1) / totalFiles) * 100);
              batchProgressFill.style.width = percent + '%';
              batchProgressPercent.textContent = percent + '%';
            }
          }

          // تحديد صورة الغلاف
          const coverIdx = (selectedCoverIndex >= 0 && selectedCoverIndex < albumImages.length) ? selectedCoverIndex : 0;
          const coverItem = albumImages[coverIdx];

          const isMultiple = albumImages.length > 1;
          const finalTitle = baseTitle || (isMultiple ? `ألبوم تصاميم طبية (${totalFiles} صور)` : selectedBatchFiles[0].name.replace(/\.[^/.]+$/, ''));
          const finalCategory = category || (isMultiple ? `ألبوم تصاميم (${totalFiles} صور)` : 'تصميم سوشيال ميديا طبي');

          const albumProject = {
            id: editId || 'project_' + now,
            type: 'design',
            title: finalTitle,
            category: finalCategory,
            desc: desc,
            mediaBlob: coverItem ? coverItem.blob : null,
            thumbUrl: coverItem ? coverItem.thumbUrl : null,
            images: albumImages, // حفظ كافة الصور داخل نفس المشروع للألبوم!
            coverIndex: coverIdx,
            isAlbum: isMultiple,
            videoBlob: null,
            videoUrl: null,
            youtubeId: null,
            aspectRatio: '1:1',
            isDefault: false,
            createdAt: editId ? undefined : now
          };

          try {
            await dbSaveProject(albumProject);
            closeProjectModal();
            await syncAndLoadAllProjects();
            const { imagesCount } = calculateMediaCounts();
            if (isMultiple) {
              showToast(`تم إنشاء ألبوم يضم (${totalFiles}) صور بنجاح! تم استخدام ${imagesCount} من 200 صورة.`);
            } else {
              showToast(`تم حفظ التصميم بنجاح! تم استخدام ${imagesCount} من 200 صورة.`);
            }
          } catch (err) {
            console.error('خطأ في حفظ المشروع:', err);
            showToast('حدث خطأ أثناء حفظ الملفات، تم تفعيل الحفظ الاحتياطي');
            closeProjectModal();
            await syncAndLoadAllProjects();
          }

          return;
        }

        // 2. معالجة ملفات الفيديو المرفوعة (تجميعها في ألبوم فيديو هولوجرام موحد مثل ألبومات الصور)
        if (type === 'video' && selectedBatchFiles.length > 0) {
          const totalFiles = selectedBatchFiles.length;

          // التحقق من حدود التخزين للـ 50 فيديو
          const { videosCount } = calculateMediaCounts();
          if (videosCount + totalFiles > CAPACITY_LIMIT_VIDEOS) {
            showToast(`تنبيه السعة: لا يمكن إضافة ${totalFiles} فيديوهات. المتبقي ${Math.max(0, CAPACITY_LIMIT_VIDEOS - videosCount)} فيديو فقط.`);
            return;
          }

          if (batchProgressWrapper) {
            batchProgressWrapper.classList.add('active');
            if (batchProgressText) {
              batchProgressText.textContent = totalFiles > 1 
                ? `جارٍ تجميع وتخزين فيديوهات الألبوم (${totalFiles} فيديوهات)...` 
                : 'جارٍ معالجة وتخزين ملف الفيديو وتوليد البوستر...';
            }
          }

          const albumVideos = [];

          for (let i = 0; i < totalFiles; i++) {
            const file = selectedBatchFiles[i];
            const fileCleanName = file.name.replace(/\.[^/.]+$/, '');
            let itemTitle = baseTitle;
            if (totalFiles > 1) {
              itemTitle = baseTitle ? `${baseTitle} (${i + 1})` : fileCleanName;
            } else {
              itemTitle = baseTitle || fileCleanName;
            }

            // الاحتفاظ بملف الفيديو كـ Blob أصلي مستقل لدعم البث والتشغيل السلس دون فقدان المقبض عند إعادة فتح المتصفح
            const cleanBlob = file.slice(0, file.size, file.type || 'video/mp4');

            // استخراج صورة البوستر المصغرة من الفيديو تلقائياً
            let videoThumb = 'assets/images/video-thumb-1.svg';
            if (file.type.startsWith('video/')) {
              try {
                videoThumb = await generateVideoThumbnail(file);
              } catch (e) {}
            }

            albumVideos.push({
              id: 'vid_' + now + '_' + i,
              name: file.name,
              title: itemTitle,
              blob: cleanBlob,
              thumbUrl: videoThumb,
              videoUrl: null,
              youtubeId: null,
              desc: desc || 'فيديو مولد بالذكاء الاصطناعي'
            });

            if (batchProgressFill && batchProgressPercent) {
              const percent = Math.round(((i + 1) / totalFiles) * 100);
              batchProgressFill.style.width = percent + '%';
              batchProgressPercent.textContent = percent + '%';
            }
          }

          const coverIdx = (selectedCoverIndex >= 0 && selectedCoverIndex < albumVideos.length) ? selectedCoverIndex : 0;
          const coverItem = albumVideos[coverIdx];

          const isMultiple = albumVideos.length > 1;
          const finalTitle = baseTitle || (isMultiple ? `ألبوم فيديوهات بالذكاء الاصطناعي (${totalFiles} فيديوهات)` : selectedBatchFiles[0].name.replace(/\.[^/.]+$/, ''));
          const finalCategory = category || (isMultiple ? `ألبوم فيديو سينمائي (${totalFiles} فيديوهات)` : 'صناعة فيديو بالذكاء الاصطناعي');

          const albumProject = {
            id: editId || 'project_' + now,
            type: 'video',
            title: finalTitle,
            category: finalCategory,
            desc: desc,
            media: coverItem ? coverItem.thumbUrl : 'assets/images/video-thumb-1.svg',
            thumbUrl: coverItem ? coverItem.thumbUrl : 'assets/images/video-thumb-1.svg',
            mediaBlob: null,
            videoBlob: coverItem ? coverItem.blob : null,
            videos: albumVideos,
            coverIndex: coverIdx,
            isAlbum: isMultiple,
            videoUrl: null,
            youtubeId: null,
            aspectRatio: aspectRatio,
            isDefault: false,
            createdAt: editId ? undefined : now
          };

          try {
            await dbSaveProject(albumProject);
            closeProjectModal();
            await syncAndLoadAllProjects();
            const counts = calculateMediaCounts();
            if (isMultiple) {
              showToast(`تم إنشاء ألبوم يضم (${totalFiles}) فيديوهات بنجاح! تم استخدام ${counts.videosCount} من 50 فيديو.`);
            } else {
              showToast(`تم حفظ الفيديو بنجاح! تم استخدام ${counts.videosCount} من 50 فيديو.`);
            }
          } catch (err) {
            console.error('خطأ في حفظ مشروع الفيديو:', err);
            showToast('حدث خطأ أثناء حفظ الفيديو، تم تفعيل الحفظ الاحتياطي');
            closeProjectModal();
            await syncAndLoadAllProjects();
          }

          return;
        }

        // 3. معالجة ملفات فيديو نصائح الكرتون
        if (type === 'cartoon' && selectedBatchFiles.length > 0) {
          const totalFiles = selectedBatchFiles.length;

          // التحقق من حدود التخزين للـ 50 فيديو كرتوني
          const { cartoonsCount } = calculateMediaCounts();
          if (cartoonsCount + totalFiles > CAPACITY_LIMIT_CARTOONS) {
            showToast(`تنبيه السعة: لا يمكن إضافة ${totalFiles} فيديوهات كرتونية. المتبقي ${Math.max(0, CAPACITY_LIMIT_CARTOONS - cartoonsCount)} فيديو كرتوني فقط.`);
            return;
          }

          if (batchProgressWrapper) {
            batchProgressWrapper.classList.add('active');
            if (batchProgressText) {
              batchProgressText.textContent = totalFiles > 1 
                ? `جارٍ تجميع وتخزين فيديوهات نصائح الكرتون (${totalFiles} فيديوهات)...` 
                : 'جارٍ معالجة وتخزين فيديو نصائح الكرتون وتوليد البوستر...';
            }
          }

          const albumVideos = [];

          for (let i = 0; i < totalFiles; i++) {
            const file = selectedBatchFiles[i];
            const fileCleanName = file.name.replace(/\.[^/.]+$/, '');
            let itemTitle = baseTitle;
            if (totalFiles > 1) {
              itemTitle = baseTitle ? `${baseTitle} (${i + 1})` : fileCleanName;
            } else {
              itemTitle = baseTitle || fileCleanName;
            }

            const cleanBlob = file.slice(0, file.size, file.type || 'video/mp4');
            let videoThumb = 'assets/images/cartoon-thumb-trio.svg';
            if (file.type.startsWith('video/')) {
              try {
                videoThumb = await generateVideoThumbnail(file);
              } catch (e) {}
            }

            albumVideos.push({
              id: 'cart_' + now + '_' + i,
              name: file.name,
              title: itemTitle,
              blob: cleanBlob,
              thumbUrl: videoThumb,
              videoUrl: null,
              youtubeId: null,
              desc: desc || 'نصائح وسلوكيات تربوية وإسلامية هادفة للأطفال والناشئة'
            });

            if (batchProgressFill && batchProgressPercent) {
              const percent = Math.round(((i + 1) / totalFiles) * 100);
              batchProgressFill.style.width = percent + '%';
              batchProgressPercent.textContent = percent + '%';
            }
          }

          const coverIdx = (selectedCoverIndex >= 0 && selectedCoverIndex < albumVideos.length) ? selectedCoverIndex : 0;
          const coverItem = albumVideos[coverIdx];

          const isMultiple = albumVideos.length > 1;
          const finalTitle = baseTitle || (isMultiple ? `ألبوم نصائح كرتون (${totalFiles} فيديوهات)` : selectedBatchFiles[0].name.replace(/\.[^/.]+$/, ''));
          const finalCategory = category || (isMultiple ? `ألبوم نصائح كرتون (${totalFiles} فيديوهات)` : 'نصائح فيديوهات الكرتون');

          const albumProject = {
            id: editId || 'project_' + now,
            type: 'video',
            isCartoon: true,
            title: finalTitle,
            category: finalCategory,
            desc: desc || 'نصائح وسلوكيات تربوية وإسلامية هادفة للأطفال والناشئة',
            media: coverItem ? coverItem.thumbUrl : 'assets/images/cartoon-thumb-trio.svg',
            thumbUrl: coverItem ? coverItem.thumbUrl : 'assets/images/cartoon-thumb-trio.svg',
            mediaBlob: null,
            videoBlob: coverItem ? coverItem.blob : null,
            videos: albumVideos,
            coverIndex: coverIdx,
            isAlbum: isMultiple,
            videoUrl: null,
            youtubeId: null,
            aspectRatio: aspectRatio,
            isDefault: false,
            createdAt: editId ? undefined : now
          };

          try {
            await dbSaveProject(albumProject);
            closeProjectModal();
            await syncAndLoadAllProjects();
            const counts = calculateMediaCounts();
            if (isMultiple) {
              showToast(`تم إنشاء ألبوم نصائح كرتون يضم (${totalFiles}) فيديوهات بنجاح! تم استخدام ${counts.cartoonsCount} من 50 فيديو.`);
            } else {
              showToast(`تم حفظ فيديو نصائح الكرتون بنجاح! تم استخدام ${counts.cartoonsCount} من 50 فيديو.`);
            }
          } catch (err) {
            console.error('خطأ في حفظ فيديو الكرتون:', err);
            showToast('حدث خطأ أثناء حفظ الفيديو، تم تفعيل الحفظ الاحتياطي');
            closeProjectModal();
            await syncAndLoadAllProjects();
          }

          return;
        }

        // 4. معالجة ملفات التعليق الصوتي المرفوعة من الجهاز
        if (type === 'audio' && selectedBatchFiles.length > 0) {
          const totalFiles = selectedBatchFiles.length;

          // التحقق من حدود التخزين للـ 50 تسجيل
          const { audiosCount } = calculateMediaCounts();
          if (audiosCount + totalFiles > CAPACITY_LIMIT_AUDIOS) {
            showToast(`تنبيه السعة: لا يمكن إضافة ${totalFiles} تسجيلات صوتية. المتبقي ${Math.max(0, CAPACITY_LIMIT_AUDIOS - audiosCount)} تسجيل فقط.`);
            return;
          }

          if (batchProgressWrapper) {
            batchProgressWrapper.classList.add('active');
            if (batchProgressText) {
              batchProgressText.textContent = totalFiles > 1 
                ? `جارٍ تجميع وتخزين تسجيلات التعليق الصوتي (${totalFiles} مقاطع)...` 
                : 'جارٍ تخزين وحفظ مقطع التعليق الصوتي في جهازك...';
            }
          }

          const albumAudios = [];

          for (let i = 0; i < totalFiles; i++) {
            const file = selectedBatchFiles[i];
            const fileCleanName = file.name.replace(/\.[^/.]+$/, '');
            let itemTitle = baseTitle;
            if (totalFiles > 1) {
              itemTitle = baseTitle ? `${baseTitle} (${i + 1})` : fileCleanName;
            } else {
              itemTitle = baseTitle || fileCleanName;
            }

            const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
            const estDuration = sizeMb > 5 ? '03:15' : (sizeMb > 2 ? '01:40' : '00:50');

            const cleanBlob = file.slice(0, file.size, file.type || 'audio/mp3');

            albumAudios.push({
              id: 'aud_' + now + '_' + i,
              name: file.name,
              title: itemTitle,
              blob: cleanBlob,
              audioDuration: estDuration,
              thumbUrl: 'assets/images/audio-thumb-voice.svg'
            });

            if (batchProgressFill && batchProgressPercent) {
              const percent = Math.round(((i + 1) / totalFiles) * 100);
              batchProgressFill.style.width = percent + '%';
              batchProgressPercent.textContent = percent + '%';
            }
          }

          const isMultiple = albumAudios.length > 1;
          const firstAudio = albumAudios[0];
          const finalTitle = baseTitle || (isMultiple ? `ألبوم تعليق صوتي (${totalFiles} مقاطع)` : selectedBatchFiles[0].name.replace(/\.[^/.]+$/, ''));
          const finalCategory = category || (isMultiple ? `ألبوم تعليق صوتي (${totalFiles} تسجيلات)` : 'تعليق صوتي (Voice Over)');

          const albumProject = {
            id: editId || 'project_' + now,
            type: 'audio',
            title: finalTitle,
            category: finalCategory,
            desc: desc || 'تسجيل تعليق صوتي طبيعي واحترافي بنقاء صوتي فائق.',
            media: 'assets/images/audio-thumb-voice.svg',
            thumbUrl: 'assets/images/audio-thumb-voice.svg',
            audioBlob: firstAudio ? firstAudio.blob : null,
            audioDuration: firstAudio ? firstAudio.audioDuration : '01:00',
            audios: albumAudios,
            isAlbum: isMultiple,
            isDefault: false,
            createdAt: editId ? undefined : now
          };

          try {
            await dbSaveProject(albumProject);
            closeProjectModal();
            await syncAndLoadAllProjects();
            const counts = calculateMediaCounts();
            if (isMultiple) {
              showToast(`تم حفظ ألبوم التعليق الصوتي (${totalFiles} مقاطع) بنجاح! تم استخدام ${counts.audiosCount} من 50 تسجيل.`);
            } else {
              showToast(`تم حفظ تسجيل التعليق الصوتي بنجاح! تم استخدام ${counts.audiosCount} من 50 تسجيل.`);
            }
          } catch (err) {
            console.error('خطأ في حفظ مشروع الصوت:', err);
            showToast('حدث خطأ أثناء حفظ الملف الصوتي');
            closeProjectModal();
            await syncAndLoadAllProjects();
          }

          return;
        }

        // 5. حالة الإضافة عبر الرابط أو التعديل الفردي
        const existingProject = editId ? cachedAllProjects.find((p) => p.id === editId) : null;
        const existingImages = existingProject && existingProject.images ? existingProject.images : null;
        const isCartoonMode = type === 'cartoon' || (existingProject && !!existingProject.isCartoon);

        let ytId = extractYouTubeId(urlInput);
        let mediaUrl = urlInput;

        if ((type === 'video' || isCartoonMode) && ytId) {
          mediaUrl = `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg`;
        } else if (type === 'audio') {
          mediaUrl = 'assets/images/audio-thumb-voice.svg';
        } else if (isCartoonMode) {
          mediaUrl = 'assets/images/cartoon-thumb-trio.svg';
        } else if (!mediaUrl) {
          mediaUrl = type === 'video' ? 'assets/images/video-thumb-1.svg' : 'assets/images/medical-design-1.svg';
        }

        const resolvedType = (type === 'cartoon' || isCartoonMode) ? 'video' : type;
        const defaultTitle = type === 'audio' ? 'تعليق صوتي جديد' : (isCartoonMode ? 'فيديو نصائح كرتون جديد' : (resolvedType === 'video' ? 'فيديو جديد' : 'تصميم جديد'));
        const defaultCat = type === 'audio' ? 'تعليق صوتي (Voice Over)' : (isCartoonMode ? 'نصائح فيديوهات الكرتون' : (resolvedType === 'video' ? 'صناعة فيديو بالذكاء الاصطناعي' : 'تصميم سوشيال ميديا طبي'));

        const singleProject = {
          id: editId || 'project_' + now,
          type: resolvedType,
          title: baseTitle || defaultTitle,
          category: category || defaultCat,
          desc: desc,
          media: mediaUrl,
          thumbUrl: (existingProject && existingProject.thumbUrl) ? existingProject.thumbUrl : mediaUrl,
          mediaBlob: existingProject ? existingProject.mediaBlob : null,
          audioBlob: existingProject ? existingProject.audioBlob : null,
          audioUrl: type === 'audio' ? urlInput : null,
          audioDuration: existingProject ? (existingProject.audioDuration || '01:00') : '01:00',
          images: existingImages,
          videos: existingProject ? existingProject.videos : null,
          audios: existingProject ? existingProject.audios : null,
          coverIndex: (existingProject && typeof existingProject.coverIndex === 'number') ? existingProject.coverIndex : 0,
          isAlbum: existingProject ? (existingProject.isAlbum || (existingImages && existingImages.length > 1)) : false,
          videoBlob: existingProject ? existingProject.videoBlob : null,
          videoUrl: resolvedType === 'video' ? urlInput : null,
          youtubeId: ytId,
          aspectRatio: aspectRatio,
          isCartoon: isCartoonMode,
          isDefault: false,
          createdAt: editId ? (existingProject ? existingProject.createdAt : now) : now
        };

        try {
          await dbSaveProject(singleProject);
          closeProjectModal();
          await syncAndLoadAllProjects();
          showToast(editId ? 'تم تحديث بيانات العمل بنجاح!' : 'تمت إضافة العمل بنجاح فوق أعمالك السابقة!');
        } catch (err) {
          console.error(err);
          showToast('حدث خطأ في حفظ المشروع');
        }
      });
    }
  }

  /* --------------------------------------------------------------------------
     13. حذف المشاريع
     -------------------------------------------------------------------------- */
  function confirmDeleteProject(id) {
    pendingDeleteId = id;
    if (deleteConfirmOverlay) {
      deleteConfirmOverlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  }

  function closeDeleteModal() {
    pendingDeleteId = null;
    if (deleteConfirmOverlay) {
      deleteConfirmOverlay.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  function initDeleteModal() {
    if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', closeDeleteModal);
    if (deleteCancelBtnTop) deleteCancelBtnTop.addEventListener('click', closeDeleteModal);

    if (deleteConfirmBtn) {
      deleteConfirmBtn.addEventListener('click', async () => {
        if (!pendingDeleteId) return;

        try {
          await dbDeleteProject(pendingDeleteId);
          closeDeleteModal();
          await syncAndLoadAllProjects();
          showToast('تم حذف العمل من المعرض');
        } catch (err) {
          console.error(err);
          showToast('حدث خطأ أثناء الحذف');
        }
      });
    }

    if (deleteConfirmOverlay) {
      deleteConfirmOverlay.addEventListener('click', (e) => {
        if (e.target === deleteConfirmOverlay) closeDeleteModal();
      });
    }
  }

  // تحويل Blob إلى Data URL (Base64) ذاتي التشغيل
  function blobToDataUrl(blob) {
    if (!blob) return Promise.resolve(null);
    if (typeof blob === 'string') return Promise.resolve(blob);
    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      } catch (e) {
        resolve(null);
      }
    });
  }

  /* --------------------------------------------------------------------------
     14. تصدير واستيراد النسخ الاحتياطية ونشر الأعمال للزوار
     -------------------------------------------------------------------------- */
  function initBackupTools() {
    // زر تثبيت ونشر الأعمال لجميع الزوار في العالم
    if (btnPublishData) {
      btnPublishData.addEventListener('click', async () => {
        try {
          const userProjects = await dbGetAllProjects();
          if (userProjects.length === 0) {
            showToast('لا توجد أعمال مضافة حالياً لتثبيتها. قم برفع أعمالك أولاً!');
            return;
          }

          showToast('جارٍ تجهيز وتحزيم أعمالك للنشر العام (js/portfolio-data.js)...', 5000);

          const publishedProjects = [];
          for (const p of userProjects) {
            const copy = { ...p };
            delete copy.blob;

            if (p.media instanceof Blob) {
              copy.media = await blobToDataUrl(p.media);
            }

            if (Array.isArray(p.images)) {
              copy.images = await Promise.all(p.images.map(async (img) => {
                const imgCopy = { ...img };
                if (img.blob) imgCopy.media = await blobToDataUrl(img.blob);
                else if (img.media instanceof Blob) imgCopy.media = await blobToDataUrl(img.media);
                delete imgCopy.blob;
                return imgCopy;
              }));
            }

            if (Array.isArray(p.audios)) {
              copy.audios = await Promise.all(p.audios.map(async (aud) => {
                const audCopy = { ...aud };
                if (aud.blob) audCopy.audioUrl = await blobToDataUrl(aud.blob);
                else if (aud.audioUrl instanceof Blob) audCopy.audioUrl = await blobToDataUrl(aud.audioUrl);
                delete audCopy.blob;
                return audCopy;
              }));
            }

            if (Array.isArray(p.videos)) {
              copy.videos = await Promise.all(p.videos.map(async (vid) => {
                const vidCopy = { ...vid };
                if (vid.blob && vid.blob.size <= 35 * 1024 * 1024) {
                  vidCopy.videoUrl = await blobToDataUrl(vid.blob);
                }
                delete vidCopy.blob;
                return vidCopy;
              }));
            }

            if (p.type === 'audio' && p.blob) {
              copy.audioUrl = await blobToDataUrl(p.blob);
            }

            if (p.type === 'video' && p.blob && p.blob.size <= 35 * 1024 * 1024) {
              copy.videoUrl = await blobToDataUrl(p.blob);
            }

            publishedProjects.push(copy);
          }

          const rawAvatar = await dbGetSetting(SETTING_PHOTO);
          const rawBrandLogo = await dbGetSetting(SETTING_BRAND_LOGO);

          const publishedSettings = {
            avatar: await blobToDataUrl(rawAvatar),
            brandLogo: await blobToDataUrl(rawBrandLogo)
          };

          const publishedPackage = {
            version: '2.0',
            lastUpdated: new Date().toISOString(),
            owner: 'كريم محمود',
            settings: publishedSettings,
            projects: publishedProjects
          };

          const fileContent = `/**
 * ==========================================================================
 * كريم محمود - قاعدة البيانات العامة للموقع (Portfolio Published Data)
 * تم الإنشاء والتحديث تلقائياً: ${new Date().toLocaleString('ar-EG')}
 * يحتوي هذا الملف على جميع الأعمال والمشاريع لتظهر لأي شخص في العالم تلقائياً.
 * ==========================================================================
 */

window.PORTFOLIO_PUBLISHED_DATA = ${JSON.stringify(publishedPackage, null, 2)};
`;

          const blob = new Blob([fileContent], { type: 'application/javascript;charset=utf-8' });
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = 'portfolio-data.js';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(downloadUrl);

          showToast('تم استخراج ملف النشر (portfolio-data.js) بنجاح! ضعه في مجلد js وسيرى أي شخص ترسل له الموقع كافة أعمالك تلقائياً!', 6000);
        } catch (err) {
          console.error('خطأ في استخراج ملف النشر:', err);
          showToast('حدث خطأ أثناء تجهيز ملف النشر');
        }
      });
    }

    if (btnExportData) {
      btnExportData.addEventListener('click', async () => {
        try {
          const userProjects = await dbGetAllProjects();
          if (userProjects.length === 0) {
            showToast('لا توجد أعمال مخصصة لتصديرها');
            return;
          }

          const exportPayload = {
            exportDate: new Date().toISOString(),
            owner: 'Karim Mahmoud',
            version: '2.0',
            projectsCount: userProjects.length,
            projects: userProjects.map((p) => ({
              id: p.id,
              type: p.type,
              title: p.title,
              category: p.category,
              desc: p.desc,
              thumbUrl: p.thumbUrl || null,
              media: typeof p.media === 'string' ? p.media : null,
              isAlbum: p.isAlbum || (Array.isArray(p.images) && p.images.length > 1) || (Array.isArray(p.videos) && p.videos.length > 1),
              coverIndex: typeof p.coverIndex === 'number' ? p.coverIndex : 0,
              images: Array.isArray(p.images) ? p.images.map((img) => ({
                id: img.id,
                name: img.name,
                thumbUrl: img.thumbUrl || null,
                media: typeof img.media === 'string' ? img.media : null
              })) : null,
              videos: Array.isArray(p.videos) ? p.videos.map((vid) => ({
                id: vid.id,
                title: vid.title,
                name: vid.name || '',
                thumbUrl: vid.thumbUrl || null,
                videoUrl: vid.videoUrl || null,
                youtubeId: vid.youtubeId || null,
                desc: vid.desc || '',
                media: typeof vid.media === 'string' ? vid.media : null
              })) : null,
              audios: Array.isArray(p.audios) ? p.audios.map((aud) => ({
                id: aud.id,
                title: aud.title,
                name: aud.name || '',
                thumbUrl: aud.thumbUrl || null,
                audioDuration: aud.audioDuration || '01:00',
                audioUrl: aud.audioUrl || null
              })) : null,
              videoUrl: p.videoUrl,
              youtubeId: p.youtubeId,
              aspectRatio: p.aspectRatio,
              audioUrl: p.audioUrl,
              audioDuration: p.audioDuration,
              isCartoon: p.isCartoon,
              createdAt: p.createdAt
            }))
          };

          const jsonBlob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
          const downloadUrl = URL.createObjectURL(jsonBlob);
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = `karim-portfolio-backup-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(downloadUrl);

          showToast('تم تصدير النسخة الاحتياطية بنجاح!');
        } catch (err) {
          console.error(err);
          showToast('حدث خطأ أثناء التصدير');
        }
      });
    }

    if (btnImportData && backupFileInput) {
      btnImportData.addEventListener('click', () => {
        backupFileInput.click();
      });

      backupFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async function (evt) {
          try {
            const data = JSON.parse(evt.target.result);
            if (data && Array.isArray(data.projects)) {
              await dbSaveBatchProjects(data.projects);
              showToast(`تم استيراد ${data.projects.length} عمل وإضافتها فوق أعمالك السابقة!`);
              await syncAndLoadAllProjects();
            } else {
              showToast('ملف النسخة الاحتياطية غير صالح');
            }
          } catch (err) {
            console.error(err);
            showToast('تعذر قراءة ملف النسخة الاحتياطية');
          }
        };
        reader.readAsText(file);
        backupFileInput.value = '';
      });
    }
  }

  /* --------------------------------------------------------------------------
     15. عارض الصور بالحجم الكامل (Lightbox) - دعم استعراض ألبومات الصور 1 تلو الآخر
     -------------------------------------------------------------------------- */
  function openLightbox(project) {
    if (!lightboxOverlay) return;

    currentFilteredDesigns = cachedAllProjects.filter((p) => p.type === 'design');
    activeLightboxIndex = currentFilteredDesigns.findIndex((p) => p.id === project.id);
    if (activeLightboxIndex === -1) activeLightboxIndex = 0;

    currentLightboxProject = project;

    const isAlbum = Array.isArray(project.images) && project.images.length > 1;
    if (isAlbum) {
      activeAlbumIndex = (typeof project.coverIndex === 'number' && project.coverIndex < project.images.length) ? project.coverIndex : 0;
    } else {
      activeAlbumIndex = 0;
    }

    updateLightboxContent();
    lightboxOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function updateLightboxContent() {
    if (!currentLightboxProject) return;

    const isAlbum = Array.isArray(currentLightboxProject.images) && currentLightboxProject.images.length > 1;

    if (isAlbum) {
      // 1. وضع الألبوم متعدد الصور: استعراض جميع الصور الأربعة أو غيرها 1 تلو الآخر
      const images = currentLightboxProject.images;
      const totalImages = images.length;
      if (activeAlbumIndex < 0 || activeAlbumIndex >= totalImages) {
        activeAlbumIndex = 0;
      }

      const currentImg = images[activeAlbumIndex];
      const imgUrl = getAlbumItemUrl(currentLightboxProject, currentImg, activeAlbumIndex);

      lightboxImage.src = imgUrl;
      lightboxImage.alt = `${currentLightboxProject.title} - صورة ${activeAlbumIndex + 1}`;
      lightboxTitle.textContent = currentLightboxProject.title;
      
      const customDesc = currentLightboxProject.desc ? `${currentLightboxProject.desc} • ` : '';
      lightboxDesc.innerHTML = `${escapeHtml(customDesc)}صورة ${activeAlbumIndex + 1} من ${totalImages} (من ألبوم: ${escapeHtml(currentLightboxProject.title)})<br><button type="button" id="btnLightboxOpenHolo" style="margin-top: 0.5rem; display: inline-flex; align-items: center; gap: 0.45rem; padding: 0.35rem 0.85rem; font-size: 0.82rem; font-weight: 700; background: rgba(0, 242, 254, 0.15); border: 1px solid rgba(0, 242, 254, 0.45); color: #00f2fe; border-radius: 6px; cursor: pointer;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><rect width="7" height="7" x="3" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="3" rx="1"></rect><rect width="7" height="7" x="14" y="14" rx="1"></rect><rect width="7" height="3" x="3" y="14" rx="1"></rect></svg><span>عرض الهولوجرام (${totalImages} تصميمات جنب بعض)</span></button>`;

      const btnHoloInLb = document.getElementById('btnLightboxOpenHolo');
      if (btnHoloInLb) {
        btnHoloInLb.addEventListener('click', (e) => {
          e.stopPropagation();
          const proj = currentLightboxProject;
          const idx = activeAlbumIndex;
          closeLightbox();
          openHologramViewer(proj, idx);
        });
      }

      if (lightboxCounter) {
        lightboxCounter.style.display = 'block';
        lightboxCounter.textContent = `صورة ${activeAlbumIndex + 1} من ${totalImages}`;
      }

      lightboxPrevBtn.style.display = totalImages > 1 ? 'flex' : 'none';
      lightboxNextBtn.style.display = totalImages > 1 ? 'flex' : 'none';

      // شريط الصور المصغرة للتنقل السريع بين صور الألبوم الواحد
      if (lightboxThumbsStrip) {
        lightboxThumbsStrip.style.display = 'flex';
        lightboxThumbsStrip.innerHTML = images.map((img, idx) => {
          const thumbSrc = img.thumbUrl || getAlbumItemUrl(currentLightboxProject, img, idx);
          const activeClass = idx === activeAlbumIndex ? 'active' : '';
          return `
            <button type="button" class="lightbox-thumb-btn ${activeClass}" data-album-idx="${idx}" title="صورة ${idx + 1} من ${totalImages}" aria-label="عرض صورة ${idx + 1}">
              <img src="${escapeHtml(thumbSrc)}" alt="صورة ${idx + 1}">
            </button>
          `;
        }).join('');

        const thumbBtns = lightboxThumbsStrip.querySelectorAll('.lightbox-thumb-btn');
        thumbBtns.forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-album-idx'), 10);
            if (!isNaN(idx)) {
              activeAlbumIndex = idx;
              updateLightboxContent();
            }
          });
        });

        const activeBtn = lightboxThumbsStrip.querySelector('.lightbox-thumb-btn.active');
        if (activeBtn) {
          activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
      }

    } else {
      // 2. وضع التصميم الفردي
      const item = currentLightboxProject;
      lightboxImage.src = getMediaUrl(item);
      lightboxImage.alt = item.title;
      lightboxTitle.textContent = item.title;
      lightboxDesc.textContent = item.desc || item.category || '';

      const totalDesigns = currentFilteredDesigns.length;
      if (lightboxCounter) {
        if (totalDesigns > 1) {
          lightboxCounter.style.display = 'block';
          lightboxCounter.textContent = `عمل ${activeLightboxIndex + 1} من ${totalDesigns}`;
        } else {
          lightboxCounter.style.display = 'none';
        }
      }

      if (lightboxThumbsStrip) {
        lightboxThumbsStrip.style.display = 'none';
        lightboxThumbsStrip.innerHTML = '';
      }

      const hasMultiple = totalDesigns > 1;
      lightboxPrevBtn.style.display = hasMultiple ? 'flex' : 'none';
      lightboxNextBtn.style.display = hasMultiple ? 'flex' : 'none';
    }
  }

  function closeLightbox() {
    if (!lightboxOverlay) return;
    lightboxOverlay.classList.remove('active');
    document.body.style.overflow = '';
  }

  function prevLightboxItem() {
    if (!currentLightboxProject) return;
    const isAlbum = Array.isArray(currentLightboxProject.images) && currentLightboxProject.images.length > 1;

    if (isAlbum) {
      const total = currentLightboxProject.images.length;
      if (total <= 1) return;
      activeAlbumIndex = (activeAlbumIndex - 1 + total) % total;
      updateLightboxContent();
    } else {
      if (currentFilteredDesigns.length <= 1) return;
      activeLightboxIndex = (activeLightboxIndex - 1 + currentFilteredDesigns.length) % currentFilteredDesigns.length;
      currentLightboxProject = currentFilteredDesigns[activeLightboxIndex];
      updateLightboxContent();
    }
  }

  function nextLightboxItem() {
    if (!currentLightboxProject) return;
    const isAlbum = Array.isArray(currentLightboxProject.images) && currentLightboxProject.images.length > 1;

    if (isAlbum) {
      const total = currentLightboxProject.images.length;
      if (total <= 1) return;
      activeAlbumIndex = (activeAlbumIndex + 1) % total;
      updateLightboxContent();
    } else {
      if (currentFilteredDesigns.length <= 1) return;
      activeLightboxIndex = (activeLightboxIndex + 1) % currentFilteredDesigns.length;
      currentLightboxProject = currentFilteredDesigns[activeLightboxIndex];
      updateLightboxContent();
    }
  }

  function initLightbox() {
    if (!lightboxOverlay) return;

    lightboxCloseBtn.addEventListener('click', closeLightbox);
    lightboxPrevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      prevLightboxItem();
    });
    lightboxNextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      nextLightboxItem();
    });

    lightboxOverlay.addEventListener('click', (e) => {
      if (e.target === lightboxOverlay) closeLightbox();
    });

    document.addEventListener('keydown', (e) => {
      if (!lightboxOverlay.classList.contains('active')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') prevLightboxItem();
      if (e.key === 'ArrowLeft') nextLightboxItem();
    });
  }

  /* --------------------------------------------------------------------------
     16. نظام مسرح العرض الهولوجرامي ثلاثي الأبعاد (3D Hologram Projection Stage)
     -------------------------------------------------------------------------- */
  const hologramOverlay = document.getElementById('hologramOverlay');
  const holoModalTitle = document.getElementById('holoModalTitle');
  const holoModalSubtitle = document.getElementById('holoModalSubtitle');
  const holoTelemetryText = document.getElementById('holoTelemetryText');
  const holoModeToggleBtn = document.getElementById('holoModeToggleBtn');
  const holoModeToggleText = document.getElementById('holoModeToggleText');
  const holoCloseBtn = document.getElementById('holoCloseBtn');

  const hologramCardsStage = document.getElementById('hologramCardsStage');
  const hologramCardsRow = document.getElementById('hologramCardsRow');
  const holoHeaderCounter = document.getElementById('holoHeaderCounter');

  const hologramSoloStage = document.getElementById('hologramSoloStage');
  const holoSoloBadge = document.getElementById('holoSoloBadge');
  const holoSoloName = document.getElementById('holoSoloName');
  const holoSoloImg = document.getElementById('holoSoloImg');
  const holoSoloBackBtn = document.getElementById('holoSoloBackBtn');
  const holoSoloPrevBtn = document.getElementById('holoSoloPrevBtn');
  const holoSoloNextBtn = document.getElementById('holoSoloNextBtn');
  const holoSoloCounter = document.getElementById('holoSoloCounter');
  const holoSoloDownloadBtn = document.getElementById('holoSoloDownloadBtn');

  let currentHoloProject = null;
  let currentHoloSoloIndex = 0;
  let isHoloSoloMode = false;
  let activeHoloBlobUrls = [];

  // تنظيف الروابط المؤقتة لمنع تسريب الذاكرة
  function cleanupHoloBlobUrls() {
    activeHoloBlobUrls.forEach((url) => {
      try {
        if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
      } catch (e) {}
    });
    activeHoloBlobUrls = [];
  }

  // استخراج رابط الصورة لعنصر في ألبوم الهولوجرام
  function getHoloItemUrl(project, imgItem, index) {
    if (!imgItem) return getMediaUrl(project);
    if (imgItem.blob && imgItem.blob instanceof Blob) {
      const url = URL.createObjectURL(imgItem.blob);
      activeHoloBlobUrls.push(url);
      return url;
    }
    if (imgItem.thumbUrl) return imgItem.thumbUrl;
    if (imgItem.url) return imgItem.url;
    if (imgItem.data) return imgItem.data;
    if (imgItem.dataUrl) return imgItem.dataUrl;
    return getMediaUrl(project);
  }

  // تشغيل فيديو محدد من داخل مسرح الهولوجرام
  function playHoloVideoItem(index) {
    if (!currentHoloProject) return;
    const items = Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0
      ? currentHoloProject.videos
      : [currentHoloProject];

    const item = items[index] || items[0];
    const videoPayload = {
      id: item.id || `${currentHoloProject.id}_vid_${index}`,
      title: item.title || currentHoloProject.title,
      desc: item.desc || currentHoloProject.desc,
      aspectRatio: currentHoloProject.aspectRatio || '16:9',
      youtubeId: item.youtubeId || (item.videoUrl ? extractYouTubeId(item.videoUrl) : currentHoloProject.youtubeId),
      videoUrl: item.videoUrl || currentHoloProject.videoUrl,
      videoBlob: item.blob || item.videoBlob || currentHoloProject.videoBlob
    };

    openVideoModal(videoPayload);
  }

  // فتح مسرح العرض الهولوجرامي
  function openHologramViewer(project, initialSoloIndex = 0) {
    if (!hologramOverlay || !project) return;
    cleanupHoloBlobUrls();

    currentHoloProject = project;
    currentHoloSoloIndex = initialSoloIndex;
    isHoloSoloMode = false;

    const isVideoHolo = project.type === 'video' || (Array.isArray(project.videos) && project.videos.length > 0);
    const items = isVideoHolo
      ? (Array.isArray(project.videos) && project.videos.length > 0 
          ? project.videos 
          : [{ title: project.title, blob: project.videoBlob, thumbUrl: project.thumbUrl || project.media, videoUrl: project.videoUrl, youtubeId: project.youtubeId, desc: project.desc }])
      : (Array.isArray(project.images) && project.images.length > 0 
          ? project.images 
          : [{ name: project.title, blob: project.mediaBlob, thumbUrl: project.thumbUrl || project.media, desc: project.desc }]);

    const totalItems = items.length;

    // تحديث بيانات الترويسة و HUD
    if (holoModalTitle) holoModalTitle.textContent = project.title;
    if (holoModalSubtitle) {
      holoModalSubtitle.textContent = totalItems > 1 
        ? (isVideoHolo 
            ? `عرض متزامن لـ ${totalItems} فيديوهات سينمائية جنباً إلى جنب بتقنية الإسقاط الهولوجرامي 3D` 
            : `عرض متزامن لـ ${totalItems} تصميمات جنباً إلى جنب بتقنية الإسقاط الهولوجرامي 3D`)
        : (isVideoHolo ? `إسقاط هولوجرامي ثلاثي الأبعاد للفيديو` : `إسقاط هولوجرامي ثلاثي الأبعاد للتصميم`);
    }

    if (holoTelemetryText) {
      holoTelemetryText.textContent = `SYS: EMITTING • 1/${totalItems} MATERIALIZING...`;
      for (let i = 1; i <= totalItems; i++) {
        setTimeout(() => {
          if (!hologramOverlay || !hologramOverlay.classList.contains('active')) return;
          if (i < totalItems) {
            holoTelemetryText.textContent = isVideoHolo
              ? `SYS: MATERIALIZING • [HOLO-VID-0${i}] ONLINE & FLOATING...`
              : `SYS: MATERIALIZING • [HOLO-0${i}] ONLINE & FLOATING...`;
          } else {
            holoTelemetryText.textContent = `SYS: ALL ${totalItems} HOLOGRAMS SYNCHRONIZED & FLOATING // 4K STABLE`;
          }
        }, i * 280);
      }
    }

    if (holoHeaderCounter) {
      holoHeaderCounter.textContent = isVideoHolo
        ? `عرض متزامن لـ ${totalItems} فيديوهات بتقنية الهولوجرام (جنب بعض)`
        : `عرض متزامن لـ ${totalItems} تصميمات بتقنية الهولوجرام (جنب بعض)`;
    }

    // إعداد وضبط طريقة العرض الافتراضية: العرض الموازي جنب بعض
    showHoloMatrixView();

    // تشغيل النافذة وقفل التمرير
    hologramOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  // إنشاء وبناء البطاقات جنباً إلى جنب (تنبثق وتطفو واحداً تلو الآخر)
  function renderHologramCardsRow() {
    if (!hologramCardsRow || !currentHoloProject) return;

    const isVideoHolo = currentHoloProject.type === 'video' || (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0);
    const items = isVideoHolo
      ? (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0 
          ? currentHoloProject.videos 
          : [{ title: currentHoloProject.title, blob: currentHoloProject.videoBlob, thumbUrl: currentHoloProject.thumbUrl || currentHoloProject.media, videoUrl: currentHoloProject.videoUrl, youtubeId: currentHoloProject.youtubeId, desc: currentHoloProject.desc }])
      : (Array.isArray(currentHoloProject.images) && currentHoloProject.images.length > 0 
          ? currentHoloProject.images 
          : [{ name: currentHoloProject.title, blob: currentHoloProject.mediaBlob, thumbUrl: currentHoloProject.thumbUrl || currentHoloProject.media, desc: currentHoloProject.desc }]);

    const total = items.length;
    hologramCardsRow.setAttribute('data-count', Math.min(4, total));

    hologramCardsRow.innerHTML = items.map((item, idx) => {
      const holoId = isVideoHolo ? `VID-0${idx + 1}` : `HOLO-${String(idx + 1).padStart(2, '0')}`;
      const title = isVideoHolo 
        ? (item.title || `فيديو سينمائي ${idx + 1}`) 
        : (item.name ? item.name.replace(/\.[^/.]+$/, '') : `تصميم ${idx + 1}`);
      const desc = item.desc || currentHoloProject.desc || (isVideoHolo ? 'إنتاج فيديو سينمائي بالذكاء الاصطناعي' : 'تصميم سوشيال ميديا طبي عالي الدقة');
      const riseDelay = (idx * 0.28).toFixed(2);
      const mediaSrc = isVideoHolo
        ? (item.thumbUrl || currentHoloProject.thumbUrl || 'assets/images/video-thumb-1.svg')
        : getHoloItemUrl(currentHoloProject, item, idx);

      return `
        <article class="holo-card ${isVideoHolo ? 'holo-card-video' : ''}" data-holo-idx="${idx}" style="--rise-delay: ${riseDelay}s;" title="${isVideoHolo ? 'انقر لتشغيل الفيديو فوراً' : 'انقر للفحص والتكبير'}">
          <div class="holo-card-beam-burst"></div>
          <div class="holo-corner tl"></div>
          <div class="holo-corner tr"></div>
          <div class="holo-corner bl"></div>
          <div class="holo-corner br"></div>

          <div class="holo-card-top-bar">
            <span class="holo-id-tag">[${holoId}]</span>
            <span class="holo-status-tag">
              <span class="holo-status-dot"></span>
              <span>${isVideoHolo ? 'HD PLAY' : '4K SYNC'}</span>
            </span>
          </div>

          <div class="holo-media-wrap">
            <img src="${escapeHtml(mediaSrc)}" alt="${escapeHtml(title)}" class="holo-img" loading="lazy">
            ${isVideoHolo ? `
              <div class="holo-video-play-badge">
                <div class="holo-play-ring"></div>
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              </div>
            ` : ''}
            <div class="holo-scan-sweep"></div>
          </div>

          <div class="holo-card-body">
            <h4 class="holo-card-title">${escapeHtml(title)}</h4>
            <p class="holo-card-desc">${escapeHtml(desc)}</p>

            <div class="holo-card-actions">
              ${isVideoHolo ? `
                <button type="button" class="btn-holo-play-direct" data-play-idx="${idx}">
                  <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <span>تشغيل الفيديو</span>
                </button>
                <button type="button" class="btn-holo-inspect" data-inspect-idx="${idx}" title="معاينة وفحص">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <span>فحص</span>
                </button>
              ` : `
                <button type="button" class="btn-holo-inspect" data-inspect-idx="${idx}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
                  <span>فحص مكبر 4K</span>
                </button>
                <a href="${escapeHtml(mediaSrc)}" download="${escapeHtml(title)}.png" class="btn-holo-dl" title="تحميل التصميم" target="_blank" rel="noopener">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                </a>
              `}
            </div>
          </div>
        </article>
      `;
    }).join('');

    // ربط نقرات البطاقات
    const cardElements = hologramCardsRow.querySelectorAll('.holo-card');
    cardElements.forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-holo-dl')) return;
        const idx = parseInt(card.getAttribute('data-holo-idx'), 10);
        if (isNaN(idx)) return;

        if (isVideoHolo) {
          if (e.target.closest('.btn-holo-inspect')) {
            openHoloSoloInspector(idx);
          } else {
            playHoloVideoItem(idx);
          }
        } else {
          openHoloSoloInspector(idx);
        }
      });
    });

    const playButtons = hologramCardsRow.querySelectorAll('.btn-holo-play-direct');
    playButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-play-idx'), 10);
        if (!isNaN(idx)) playHoloVideoItem(idx);
      });
    });

    const inspectButtons = hologramCardsRow.querySelectorAll('.btn-holo-inspect');
    inspectButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-inspect-idx'), 10);
        if (!isNaN(idx)) openHoloSoloInspector(idx);
      });
    });
  }

  // إظهار العرض الرباعي المتوازي (جنب بعض)
  function showHoloMatrixView() {
    isHoloSoloMode = false;
    if (hologramCardsStage) hologramCardsStage.style.display = 'flex';
    if (hologramSoloStage) hologramSoloStage.style.display = 'none';
    if (holoModeToggleText) holoModeToggleText.textContent = 'فحص فردي مكبر';
    const mediaWrap = document.querySelector('.holo-solo-media-wrap');
    if (mediaWrap) {
      const existingPlayOverlay = mediaWrap.querySelector('.holo-solo-play-overlay');
      if (existingPlayOverlay) existingPlayOverlay.remove();
    }
    renderHologramCardsRow();
  }

  // فتح وضع الفحص الفردي المكبر
  function openHoloSoloInspector(index) {
    if (!currentHoloProject) return;
    const isVideoHolo = currentHoloProject.type === 'video' || (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0);
    const items = isVideoHolo
      ? (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0 
          ? currentHoloProject.videos 
          : [{ title: currentHoloProject.title, blob: currentHoloProject.videoBlob, thumbUrl: currentHoloProject.thumbUrl || currentHoloProject.media, videoUrl: currentHoloProject.videoUrl, youtubeId: currentHoloProject.youtubeId, desc: currentHoloProject.desc }])
      : (Array.isArray(currentHoloProject.images) && currentHoloProject.images.length > 0 
          ? currentHoloProject.images 
          : [{ name: currentHoloProject.title, blob: currentHoloProject.mediaBlob, thumbUrl: currentHoloProject.thumbUrl || currentHoloProject.media, desc: currentHoloProject.desc }]);

    if (index < 0 || index >= items.length) index = 0;
    currentHoloSoloIndex = index;
    isHoloSoloMode = true;

    if (hologramCardsStage) hologramCardsStage.style.display = 'none';
    if (hologramSoloStage) hologramSoloStage.style.display = 'flex';
    if (holoModeToggleText) holoModeToggleText.textContent = 'عرض موازي (جنب بعض)';

    updateHoloSoloContent();
  }

  // تحديث محتوى الفحص الفردي
  function updateHoloSoloContent() {
    if (!currentHoloProject || !isHoloSoloMode) return;
    const isVideoHolo = currentHoloProject.type === 'video' || (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0);
    const items = isVideoHolo
      ? (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0 
          ? currentHoloProject.videos 
          : [{ title: currentHoloProject.title, blob: currentHoloProject.videoBlob, thumbUrl: currentHoloProject.thumbUrl || currentHoloProject.media, videoUrl: currentHoloProject.videoUrl, youtubeId: currentHoloProject.youtubeId, desc: currentHoloProject.desc }])
      : (Array.isArray(currentHoloProject.images) && currentHoloProject.images.length > 0 
          ? currentHoloProject.images 
          : [{ name: currentHoloProject.title, blob: currentHoloProject.mediaBlob, thumbUrl: currentHoloProject.thumbUrl || currentHoloProject.media, desc: currentHoloProject.desc }]);

    const total = items.length;
    if (currentHoloSoloIndex >= total) currentHoloSoloIndex = 0;
    const item = items[currentHoloSoloIndex];
    const holoId = isVideoHolo ? `VID-0${currentHoloSoloIndex + 1}` : `HOLO-${String(currentHoloSoloIndex + 1).padStart(2, '0')}`;
    const name = isVideoHolo 
      ? (item.title || `فيديو سينمائي ${currentHoloSoloIndex + 1}`) 
      : (item.name ? item.name.replace(/\.[^/.]+$/, '') : `تصميم ${currentHoloSoloIndex + 1}`);
    const mediaSrc = isVideoHolo
      ? (item.thumbUrl || currentHoloProject.thumbUrl || 'assets/images/video-thumb-1.svg')
      : getHoloItemUrl(currentHoloProject, item, currentHoloSoloIndex);

    if (holoSoloBadge) holoSoloBadge.textContent = isVideoHolo ? `[${holoId} // CINEMA-VIDEO]` : `[${holoId} // ULTRA-RES]`;
    if (holoSoloName) holoSoloName.textContent = name;
    if (holoSoloImg) {
      holoSoloImg.src = mediaSrc;
      holoSoloImg.alt = name;
    }
    if (holoSoloCounter) holoSoloCounter.textContent = `${currentHoloSoloIndex + 1} / ${total}`;

    if (holoSoloDownloadBtn) {
      if (isVideoHolo) {
        holoSoloDownloadBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>تشغيل هذا الفيديو الآن</span>
        `;
        holoSoloDownloadBtn.removeAttribute('download');
        holoSoloDownloadBtn.href = '#';
        holoSoloDownloadBtn.onclick = (e) => {
          e.preventDefault();
          playHoloVideoItem(currentHoloSoloIndex);
        };
      } else {
        holoSoloDownloadBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>تحميل بدقة كاملة</span>
        `;
        holoSoloDownloadBtn.setAttribute('download', `${name}.png`);
        holoSoloDownloadBtn.href = mediaSrc;
        holoSoloDownloadBtn.onclick = null;
      }
    }

    const mediaWrap = document.querySelector('.holo-solo-media-wrap');
    if (mediaWrap) {
      const existingPlayOverlay = mediaWrap.querySelector('.holo-solo-play-overlay');
      if (existingPlayOverlay) existingPlayOverlay.remove();

      if (isVideoHolo) {
        const playOverlay = document.createElement('div');
        playOverlay.className = 'holo-solo-play-overlay';
        playOverlay.innerHTML = `
          <div class="holo-solo-play-circle">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
          <span class="holo-solo-play-text">انقر لتشغيل الفيديو فوراً</span>
        `;
        playOverlay.addEventListener('click', () => {
          playHoloVideoItem(currentHoloSoloIndex);
        });
        mediaWrap.appendChild(playOverlay);
      }
    }

    if (holoSoloPrevBtn) holoSoloPrevBtn.style.display = total > 1 ? 'inline-flex' : 'none';
    if (holoSoloNextBtn) holoSoloNextBtn.style.display = total > 1 ? 'inline-flex' : 'none';
  }

  function nextHoloSoloItem() {
    if (!currentHoloProject) return;
    const isVideoHolo = currentHoloProject.type === 'video' || (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0);
    const total = isVideoHolo
      ? (currentHoloProject.videos ? currentHoloProject.videos.length : 1)
      : (currentHoloProject.images ? currentHoloProject.images.length : 1);
    if (total <= 1) return;
    currentHoloSoloIndex = (currentHoloSoloIndex + 1) % total;
    updateHoloSoloContent();
  }

  function prevHoloSoloItem() {
    if (!currentHoloProject) return;
    const isVideoHolo = currentHoloProject.type === 'video' || (Array.isArray(currentHoloProject.videos) && currentHoloProject.videos.length > 0);
    const total = isVideoHolo
      ? (currentHoloProject.videos ? currentHoloProject.videos.length : 1)
      : (currentHoloProject.images ? currentHoloProject.images.length : 1);
    if (total <= 1) return;
    currentHoloSoloIndex = (currentHoloSoloIndex - 1 + total) % total;
    updateHoloSoloContent();
  }

  function closeHologramViewer() {
    if (!hologramOverlay) return;
    hologramOverlay.classList.remove('active');
    document.body.style.overflow = '';
    currentHoloProject = null;
    cleanupHoloBlobUrls();
    if (videoModalOverlay && videoModalOverlay.classList.contains('active')) {
      closeVideoModal();
    }
  }

  function initHologramStage() {
    if (!hologramOverlay) return;

    if (holoCloseBtn) {
      holoCloseBtn.addEventListener('click', closeHologramViewer);
    }

    if (holoModeToggleBtn) {
      holoModeToggleBtn.addEventListener('click', () => {
        if (isHoloSoloMode) {
          showHoloMatrixView();
        } else {
          openHoloSoloInspector(currentHoloSoloIndex || 0);
        }
      });
    }

    if (holoSoloBackBtn) {
      holoSoloBackBtn.addEventListener('click', showHoloMatrixView);
    }

    if (holoSoloPrevBtn) {
      holoSoloPrevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        prevHoloSoloItem();
      });
    }

    if (holoSoloNextBtn) {
      holoSoloNextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        nextHoloSoloItem();
      });
    }

    // إغلاق العرض عند النقر على الخلفية الفارغة
    hologramOverlay.addEventListener('click', (e) => {
      if (e.target === hologramOverlay || e.target.id === 'hologramViewport') {
        closeHologramViewer();
      }
    });

    // التحكم بلوحة المفاتيح: ESC للإغلاق، الأسهم للتنقل
    document.addEventListener('keydown', (e) => {
      if (!hologramOverlay.classList.contains('active')) return;

      if (e.key === 'Escape') {
        closeHologramViewer();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (isHoloSoloMode) prevHoloSoloItem();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (isHoloSoloMode) nextHoloSoloItem();
      }
    });
  }

  /* --------------------------------------------------------------------------
     16. مشغل الفيديو فائق السلاسة (YouTube & HTML5 Video)
     -------------------------------------------------------------------------- */
  let currentModalVideoProject = null;
  let currentModalVideoIndex = 0;

  function openVideoModal(project, targetVideoIndex = 0) {
    if (!videoModalOverlay || !videoPlayerContainer || !project) return;

    currentModalVideoProject = project;
    currentModalVideoIndex = targetVideoIndex;

    // تفعيل وضع تشغيل الفيديو لتجميد مؤثرات الخلفية وتوفير كامل عتاد كارت الشاشة والمعالج للفيديو بسلاسة تامة
    document.body.classList.add('video-playing');

    const hasMultiple = Array.isArray(project.videos) && project.videos.length > 1;
    const items = hasMultiple ? project.videos : [project];
    const activeItem = items[targetVideoIndex] || items[0] || project;

    const activeTitle = activeItem.title || project.title || 'مشاهدة الفيديو';
    const activeDesc = activeItem.desc || project.desc || project.category || '';

    videoModalTitle.textContent = activeTitle;
    videoModalDesc.textContent = activeDesc;

    const isVertical = (activeItem.aspectRatio || project.aspectRatio) === '9:16';
    const cardEl = videoModalOverlay.querySelector('.video-modal-card');
    if (isVertical) {
      videoPlayerContainer.classList.add('vertical-aspect');
      if (cardEl) cardEl.classList.add('has-vertical');
    } else {
      videoPlayerContainer.classList.remove('vertical-aspect');
      if (cardEl) cardEl.classList.remove('has-vertical');
    }

    const ytId = activeItem.youtubeId || (activeItem.videoUrl ? extractYouTubeId(activeItem.videoUrl) : (project.youtubeId || (project.videoUrl ? extractYouTubeId(project.videoUrl) : null)));
    const directVideoUrl = getVideoUrl(project, targetVideoIndex);

    if (ytId) {
      // إعدادات مشغل يوتيوب فائقة الدقة والسرعة (HD 1080p وتشغيل فوري عند النقر)
      const ytParams = [
        'autoplay=1',
        'playsinline=1',
        'enablejsapi=1',
        'rel=0',
        'modestbranding=1',
        'iv_load_policy=3',
        'controls=1',
        'fs=1',
        'hd=1',
        'vq=hd1080',
        'highres=1',
        'loop=1',
        'playlist=' + ytId
      ];
      if (window.location && window.location.protocol && window.location.protocol.startsWith('http') && window.location.origin) {
        ytParams.push(`origin=${encodeURIComponent(window.location.origin)}`);
      }
      const ytSrc = `https://www.youtube.com/embed/${ytId}?${ytParams.join('&')}`;

      videoPlayerContainer.innerHTML = `
        <iframe 
          id="activeYoutubeModalIframe"
          src="${ytSrc}" 
          title="${escapeHtml(activeTitle)}" 
          frameborder="0" 
          loading="eager"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" 
          allowfullscreen
          style="width: 100%; height: 100%; border: none; border-radius: 12px; display: block; background: #000;">
        </iframe>
        <div class="video-modal-yt-fallback" style="margin-top: 0.65rem; text-align: center;">
          <a href="https://www.youtube.com/watch?v=${ytId}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 0.45rem; border-color: rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 0.85rem; padding: 0.4rem 0.85rem; text-decoration: none;">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
            <span>مشاهدة الفيديو على YouTube ↗</span>
          </a>
        </div>
      `;

      const ytIframe = videoPlayerContainer.querySelector('#activeYoutubeModalIframe');
      if (ytIframe) {
        const sendYtCmd = (func, args = []) => {
          try {
            if (ytIframe.contentWindow) {
              ytIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
            }
          } catch (e) {}
        };
        ytIframe.addEventListener('load', () => {
          sendYtCmd('playVideo');
          sendYtCmd('setPlaybackQuality', ['hd1080']);
          sendYtCmd('setPlaybackQualityRange', ['hd1080', 'highres']);
        });
        setTimeout(() => {
          sendYtCmd('playVideo');
          sendYtCmd('setPlaybackQuality', ['hd1080']);
        }, 300);
        setTimeout(() => {
          sendYtCmd('playVideo');
          sendYtCmd('setPlaybackQuality', ['hd1080']);
        }, 800);
      }
    } else if (directVideoUrl) {
      // مشغل HTML5 الأصلي مع التشغيل الفوري والتعامل الذكي مع سياسات المتصفح
      videoPlayerContainer.innerHTML = `
        <video 
          controls 
          autoplay 
          playsinline 
          webkit-playsinline 
          preload="auto" 
          controlslist="nodownload"
          src="${escapeHtml(directVideoUrl)}"
          style="width: 100%; height: 100%; object-fit: contain; background: #000; cursor: pointer;"
        >
          <source src="${escapeHtml(directVideoUrl)}" type="video/mp4">
          <source src="${escapeHtml(directVideoUrl)}" type="video/webm">
          المتصفح لا يدعم تشغيل هذا الفيديو مباشرة.
        </video>
        <button type="button" class="video-unmute-pill" id="videoUnmutePill" style="display:none;" title="تفعيل الصوت">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
          <span>انقر لتفعيل الصوت 🔊</span>
        </button>
        <div class="video-tap-feedback" id="videoTapFeedback"></div>
      `;

      const vid = videoPlayerContainer.querySelector('video');
      const unmutePill = videoPlayerContainer.querySelector('#videoUnmutePill');

      if (unmutePill && vid) {
        unmutePill.addEventListener('click', (e) => {
          e.stopPropagation();
          vid.muted = false;
          unmutePill.style.display = 'none';
        });
      }

      const attemptPlay = () => {
        if (!vid) return;
        const playPromise = vid.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            if (unmutePill) unmutePill.style.display = 'none';
          }).catch((err) => {
            console.warn('Autoplay with sound prevented, starting muted:', err);
            vid.muted = true;
            vid.play().then(() => {
              if (unmutePill) unmutePill.style.display = 'inline-flex';
            }).catch((e2) => {
              console.warn('Muted autoplay fallback error:', e2);
            });
          });
        }
      };

      // التشغيل المباشر الفوري في سياق النقر
      attemptPlay();

      // تأكيد التشغيل بمجرد جاهزية الميتاداتا
      vid.addEventListener('loadeddata', () => {
        if (vid.paused) attemptPlay();
      }, { once: true });

      // النقر على مساحة الفيديو للتشغيل/الإيقاف المؤقت
      vid.addEventListener('click', (e) => {
        const rect = vid.getBoundingClientRect();
        if (e.clientY > rect.bottom - 46) return; // تم النقر على شريط التحكم الأصلي
        e.stopPropagation();
        if (vid.paused) {
          attemptPlay();
          showVideoTapFeedback('play');
        } else {
          vid.pause();
          showVideoTapFeedback('pause');
        }
      });
    } else {
      videoPlayerContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); text-align: center; padding: 2rem;">
          <p>معاينة الفيديو غير متاحة. يرجى التحقق من الملف.</p>
        </div>
      `;
    }

    // عرض قائمة الفيديوهات إن كان ألبوماً
    renderVideoModalPlaylist(project, targetVideoIndex);

    videoModalOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function renderVideoModalPlaylist(project, activeIdx) {
    const playlistContainer = document.getElementById('videoModalPlaylistContainer');
    if (!playlistContainer) return;

    if (!Array.isArray(project.videos) || project.videos.length <= 1) {
      playlistContainer.innerHTML = '';
      playlistContainer.style.display = 'none';
      return;
    }

    playlistContainer.style.display = 'block';
    playlistContainer.innerHTML = `
      <div class="video-modal-playlist">
        <div class="video-playlist-header">
          <span class="playlist-label">قائمة فيديوهات الألبوم (${project.videos.length} فيديوهات):</span>
          <button type="button" class="btn-playlist-holo" id="btnOpenHoloFromModal" title="عرض الفيديوهات جنباً إلى جنب في مسرح الهولوجرام">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span>عرض هولوجرامي 3D جنباً إلى جنب</span>
          </button>
        </div>
        <div class="video-playlist-items">
          ${project.videos.map((vidItem, vIdx) => {
            const isActive = vIdx === activeIdx;
            const vThumb = vidItem.thumbUrl || project.thumbUrl || 'assets/images/video-thumb-1.svg';
            const vTitle = vidItem.title || `فيديو ${vIdx + 1}`;
            return `
              <button type="button" class="video-playlist-card ${isActive ? 'active' : ''}" data-vidx="${vIdx}" title="${escapeHtml(vTitle)}">
                <div class="vcard-thumb-wrap">
                  <img src="${escapeHtml(vThumb)}" alt="${escapeHtml(vTitle)}" loading="lazy">
                  <div class="vcard-play-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  </div>
                </div>
                <div class="vcard-info">
                  <span class="vcard-num">0${vIdx + 1}</span>
                  <span class="vcard-name">${escapeHtml(vTitle)}</span>
                </div>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // ربط نقرات قائمة الفيديوهات
    const playlistButtons = playlistContainer.querySelectorAll('.video-playlist-card');
    playlistButtons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const vidx = parseInt(btn.getAttribute('data-vidx'), 10);
        if (!isNaN(vidx) && vidx !== activeIdx) {
          openVideoModal(project, vidx);
        }
      });
    });

    const btnHolo = playlistContainer.querySelector('#btnOpenHoloFromModal');
    if (btnHolo) {
      btnHolo.addEventListener('click', (e) => {
        e.stopPropagation();
        closeVideoModal();
        openHologramViewer(project, activeIdx);
      });
    }
  }

  function showVideoTapFeedback(type) {
    const feedback = document.getElementById('videoTapFeedback');
    if (!feedback) return;
    feedback.innerHTML = type === 'play'
      ? '<svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor" style="width:28px;height:28px;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
    feedback.classList.add('show');
    setTimeout(() => {
      feedback.classList.remove('show');
    }, 450);
  }

  function closeVideoModal() {
    if (!videoModalOverlay || !videoPlayerContainer) return;

    // تفريغ وإيقاف فوري لأي فيديو أو إطار لمنع تسريب الذاكرة أو الصوت في الخلفية
    const vid = videoPlayerContainer.querySelector('video');
    if (vid) {
      try {
        vid.pause();
        vid.removeAttribute('src');
        vid.load();
      } catch (e) {}
    }

    const iframe = videoPlayerContainer.querySelector('iframe');
    if (iframe) {
      try { iframe.src = 'about:blank'; } catch (e) {}
    }

    videoPlayerContainer.innerHTML = '';
    const playlistContainer = document.getElementById('videoModalPlaylistContainer');
    if (playlistContainer) {
      playlistContainer.innerHTML = '';
      playlistContainer.style.display = 'none';
    }

    videoModalOverlay.classList.remove('active');
    document.body.classList.remove('video-playing');

    // إذا لم يكن مسرح الهولوجرام مفتوحاً، نلغي قفل التمرير
    if (!hologramOverlay || !hologramOverlay.classList.contains('active')) {
      document.body.style.overflow = '';
    }
  }

  function initVideoModal() {
    if (!videoModalOverlay) return;

    videoModalCloseBtn.addEventListener('click', closeVideoModal);

    videoModalOverlay.addEventListener('click', (e) => {
      if (e.target === videoModalOverlay) closeVideoModal();
    });
// ربط كروت معرض فيديوهات YouTube لفتح المشغل عند النقر
    const videoGallerySection = document.getElementById('videoGallerySection');
    if (videoGallerySection) {
      videoGallerySection.addEventListener('click', (e) => {
        const card = e.target.closest('.video-card-item');
        if (!card) return;
        const ytId = card.getAttribute('data-yt-id');
        if (!ytId) return;
        if (e.target.closest('a')) return;
        window.open('https://www.youtube.com/watch?v=' + encodeURIComponent(ytId), '_blank', 'noopener,noreferrer');
      });
    }


    document.addEventListener('keydown', (e) => {
      if (!videoModalOverlay.classList.contains('active')) return;
      if (e.key === 'Escape') {
        closeVideoModal();
      } else if (e.key === ' ' || e.code === 'Space') {
        const vid = videoPlayerContainer.querySelector('video');
        if (vid) {
          e.preventDefault();
          if (vid.paused) {
            vid.play();
            showVideoTapFeedback('play');
          } else {
            vid.pause();
            showVideoTapFeedback('pause');
          }
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const vid = videoPlayerContainer.querySelector('video');
        if (vid && !isNaN(vid.duration)) {
          e.preventDefault();
          const step = (e.key === 'ArrowRight') ? 5 : -5;
          vid.currentTime = Math.max(0, Math.min(vid.duration, vid.currentTime + step));
        }
      } else if (e.key === 'm' || e.key === 'M') {
        const vid = videoPlayerContainer.querySelector('video');
        if (vid) {
          e.preventDefault();
          vid.muted = !vid.muted;
          const pill = document.getElementById('videoUnmutePill');
          if (pill) pill.style.display = vid.muted ? 'inline-flex' : 'none';
        }
      }
    });
  }

  function extractYouTubeId(url) {
    if (!url || typeof url !== 'string') return null;
    const baseName = url.split('/').pop().split('\\').pop();
    if (window.LOCAL_VIDEO_TO_YOUTUBE_MAP && window.LOCAL_VIDEO_TO_YOUTUBE_MAP[baseName]) {
      return window.LOCAL_VIDEO_TO_YOUTUBE_MAP[baseName].ytId;
    }
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
    return match ? match[1] : null;
  }

  /* --------------------------------------------------------------------------
     17. نموذج التواصل
     -------------------------------------------------------------------------- */
  function initContactForm() {
    if (!contactForm) return;

    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('senderName').value.trim();
      const email = document.getElementById('senderEmail').value.trim();
      const subject = document.getElementById('senderSubject').value.trim() || 'طلب تواصل وتعاون';
      const message = document.getElementById('senderMessage').value.trim();

      if (!name || !email || !message) {
        showToast('يرجى ملء كافة الحقول الإلزامية');
        return;
      }

      const recipient = 'karimaboela105@gmail.com';
      const mailBody = `الاسم: ${name}\nالبريد الإلكتروني: ${email}\n\nنص الرسالة:\n${message}`;
      const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody)}`;

      showToast('جارٍ فتح تطبيق البريد لإرسال رسالتك...');

      setTimeout(() => {
        window.location.href = mailtoUrl;
      }, 400);
    });
  }

  /* --------------------------------------------------------------------------
     18. تصفية وتبويب قسم الخدمات التفاعلية
     -------------------------------------------------------------------------- */
  function initServicesFilter() {
    const serviceTabBtns = document.querySelectorAll('.service-tab-btn');
    const serviceCards = document.querySelectorAll('#servicesGrid .service-card');
    if (!serviceTabBtns.length || !serviceCards.length) return;

    serviceTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        serviceTabBtns.forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');

        const filterVal = btn.getAttribute('data-service-filter') || 'all';

        serviceCards.forEach((card) => {
          const cardCat = card.getAttribute('data-service-cat');
          if (filterVal === 'all' || cardCat === filterVal) {
            card.classList.remove('hidden');
          } else {
            card.classList.add('hidden');
          }
        });
      });
    });
  }

  /* --------------------------------------------------------------------------
     19. دالة مساعدة لتأمين النصوص
     -------------------------------------------------------------------------- */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* --------------------------------------------------------------------------
     20. شريط عرض الصور البانورامي التفاعلي بطول الموقع (Ribbon Showcase Slider)
     - يدعم رفع صور غير محدودة (100+ صورة) من الجهاز وتخزينها المستديم في IndexedDB
     - تحريك وسحب بلمس الإصبع على الهواتف وبالماوس على الكمبيوتر مع محاذاة تلقائية (Snap)
     - تكبير وفحص الصورة بنقرة واحدة (Lightbox) وزر لحذف الصور الفردية
     - عداد تلقائي للصور وشريط تقدم متحرك يتفاعل مع التمرير
     -------------------------------------------------------------------------- */
  const SETTING_RIBBON_SLIDES = 'km_ribbon_custom_slides';
  const SETTING_RIBBON_HIDDEN = 'km_ribbon_hidden_slides';
  let ribbonCustomSlides = [];
  let ribbonHiddenSlideIds = new Set();
  let ribbonActiveSlides = [];

  async function loadRibbonSlidesData() {
    try {
      // 1. الشرائح المنشورة الافتراضية (فارغة افتراضياً بناء على طلب كريم ليقوم برفع صوره الخاصة من جهازه)
      let publishedSlides = [];
      if (typeof window !== 'undefined' && window.PORTFOLIO_PUBLISHED_DATA && Array.isArray(window.PORTFOLIO_PUBLISHED_DATA.showcaseSlides)) {
        publishedSlides = window.PORTFOLIO_PUBLISHED_DATA.showcaseSlides;
      }

      // 2. الشرائح المرفوعة من المستخدم في IndexedDB
      const savedCustom = await dbGetSetting(SETTING_RIBBON_SLIDES);
      if (Array.isArray(savedCustom)) {
        ribbonCustomSlides = savedCustom.map((s) => {
          let u = s.url;
          if (s.blob instanceof Blob) {
            u = URL.createObjectURL(s.blob);
          }
          return { ...s, url: u };
        });
      } else {
        ribbonCustomSlides = [];
      }

      // 3. الشرائح المحذوفة
      const savedHidden = await dbGetSetting(SETTING_RIBBON_HIDDEN);
      if (Array.isArray(savedHidden)) {
        ribbonHiddenSlideIds = new Set(savedHidden);
      } else {
        ribbonHiddenSlideIds = new Set();
      }

      // دمج الشرائح مع استبعاد المحذوفة ومنع أي تكرار نهائياً
      const seenSlideKeys = new Set();
      const combined = [];
      for (const s of [...ribbonCustomSlides, ...publishedSlides]) {
        if (!s || !s.id || ribbonHiddenSlideIds.has(s.id)) continue;
        const key = (s.title || '').trim().toLowerCase() + '::' + (s.url || '').trim();
        if (seenSlideKeys.has(key)) continue;
        seenSlideKeys.add(key);
        combined.push(s);
      }
      ribbonActiveSlides = combined;
      return ribbonActiveSlides;
    } catch (e) {
      console.warn('تعذر تحميل بيانات شريط العرض:', e);
      return [];
    }
  }

  function renderRibbonSlides() {
    const track = document.getElementById('ribbonTrack');
    const counterBadge = document.getElementById('ribbonCounterBadge');
    const prevBtn = document.getElementById('ribbonPrevBtn');
    const nextBtn = document.getElementById('ribbonNextBtn');
    const bar = document.getElementById('ribbonProgressBar');
    if (!track) return;

    if (counterBadge) {
      counterBadge.textContent = ribbonActiveSlides.length + ' صورة';
    }

    if (ribbonActiveSlides.length === 0) {
      track.innerHTML = `
        <div class="ribbon-empty-state">
          <div class="ribbon-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect>
              <circle cx="9" cy="9" r="2"></circle>
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
            </svg>
          </div>
          <h3 class="ribbon-empty-title">شريط عرض الصور فارغ حالياً</h3>
          <p class="ribbon-empty-desc">اضغط على زر <strong>"+ تحميل صور من الجهاز (100+ صورة)"</strong> بالأعلى لرفع صورك من جهازك وعرضها هنا بالحجم الكبير مع إمكانية تحريكها بيدك والتوقف على كل صورة وتكبيرها.</p>
        </div>
      `;
      if (prevBtn) prevBtn.style.display = 'none';
      if (nextBtn) nextBtn.style.display = 'none';
      if (bar) bar.style.width = '0%';
      return;
    }

    if (prevBtn) prevBtn.style.display = '';
    if (nextBtn) nextBtn.style.display = '';

    track.innerHTML = ribbonActiveSlides
      .map((slide, idx) => {
        const sId = escapeHtml(slide.id || `slide-${idx}`);
        const sTitle = escapeHtml(slide.title || 'صورة من الأعمال');
        return `
          <div class="ribbon-slide-card" data-slide-id="${sId}" data-slide-idx="${idx}" role="button" tabindex="0" title="${sTitle}">
            <button type="button" class="ribbon-slide-del-btn" data-del-id="${sId}" title="حذف هذه الصورة من الشريط" aria-label="حذف">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <img class="ribbon-slide-img" src="${slide.url}" alt="${sTitle}" loading="lazy">
            <div class="ribbon-slide-overlay">
              <span class="ribbon-slide-title">${sTitle}</span>
              <span class="ribbon-slide-zoom-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
              </span>
            </div>
          </div>
        `;
      })
      .join('');

    updateRibbonProgress();
  }

  function updateRibbonProgress() {
    const track = document.getElementById('ribbonTrack');
    const bar = document.getElementById('ribbonProgressBar');
    if (!track || !bar) return;
    const maxScroll = track.scrollWidth - track.clientWidth;
    if (maxScroll <= 0) {
      bar.style.width = '100%';
      return;
    }
    const scrollOffset = Math.abs(track.scrollLeft);
    const pct = Math.min(100, Math.max(0, (scrollOffset / maxScroll) * 100));
    bar.style.width = pct.toFixed(1) + '%';
  }

  async function handleRibbonFileUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const count = files.length;
    showToast(`جاري معالجة ${count} صورة وحفظها في التخزين الدائم...`);

    const newSlides = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type || !file.type.startsWith('image/')) continue;
      const slideId = 'user-slide-' + Date.now() + '-' + i + '-' + Math.random().toString(36).substr(2, 5);
      const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      const objectUrl = URL.createObjectURL(file);

      newSlides.push({
        id: slideId,
        title: cleanTitle,
        url: objectUrl,
        blob: file,
        isCustom: true,
        createdAt: Date.now()
      });
    }

    if (newSlides.length > 0) {
      ribbonCustomSlides = [...newSlides, ...ribbonCustomSlides];
      await dbSaveSetting(SETTING_RIBBON_SLIDES, ribbonCustomSlides);
      await loadRibbonSlidesData();
      renderRibbonSlides();

      const track = document.getElementById('ribbonTrack');
      if (track) {
        track.scrollTo({ left: 0, behavior: 'smooth' });
      }
      showToast(`تمت إضافة ${newSlides.length} صورة بنجاح إلى شريط العرض!`);
    }
    event.target.value = '';
  }

  async function handleRibbonDeleteSlide(slideId) {
    if (!slideId) return;
    const customIdx = ribbonCustomSlides.findIndex((s) => s.id === slideId);
    if (customIdx !== -1) {
      ribbonCustomSlides.splice(customIdx, 1);
      await dbSaveSetting(SETTING_RIBBON_SLIDES, ribbonCustomSlides);
    } else {
      ribbonHiddenSlideIds.add(slideId);
      await dbSaveSetting(SETTING_RIBBON_HIDDEN, Array.from(ribbonHiddenSlideIds));
    }
    await loadRibbonSlidesData();
    renderRibbonSlides();
    showToast('تم حذف الصورة من الشريط.');
  }

  async function initRibbonShowcaseSlider() {
    const track = document.getElementById('ribbonTrack');
    const uploadBtn = document.getElementById('btnRibbonUpload');
    const fileInput = document.getElementById('ribbonFileInput');
    const prevBtn = document.getElementById('ribbonPrevBtn');
    const nextBtn = document.getElementById('ribbonNextBtn');
    if (!track) return;

    await loadRibbonSlidesData();
    renderRibbonSlides();

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => {
        fileInput.click();
      });
      fileInput.addEventListener('change', handleRibbonFileUpload);
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const step = track.clientWidth * 0.75;
        track.scrollBy({ left: step, behavior: 'smooth' });
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const step = track.clientWidth * 0.75;
        track.scrollBy({ left: -step, behavior: 'smooth' });
      });
    }

    track.addEventListener('scroll', updateRibbonProgress, { passive: true });

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;
    let hasDragged = false;

    track.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ribbon-slide-del-btn')) return;
      isDown = true;
      hasDragged = false;
      track.classList.add('dragging');
      startX = e.pageX - track.offsetLeft;
      scrollLeft = track.scrollLeft;
    });

    track.addEventListener('mouseleave', () => {
      isDown = false;
      track.classList.remove('dragging');
    });

    track.addEventListener('mouseup', () => {
      isDown = false;
      track.classList.remove('dragging');
      setTimeout(() => {
        hasDragged = false;
      }, 60);
    });

    track.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - track.offsetLeft;
      const walk = (x - startX) * 1.5;
      if (Math.abs(walk) > 5) {
        hasDragged = true;
      }
      track.scrollLeft = scrollLeft - walk;
    });

    track.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.ribbon-slide-del-btn');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const slideId = delBtn.getAttribute('data-del-id');
        handleRibbonDeleteSlide(slideId);
        return;
      }

      if (hasDragged) return;

      const card = e.target.closest('.ribbon-slide-card');
      if (card) {
        const slideId = card.getAttribute('data-slide-id');
        const slide = ribbonActiveSlides.find((s) => s.id === slideId);
        if (slide) {
          openLightbox({
            id: slide.id,
            title: slide.title || 'معاينة الصورة',
            media: slide.url,
            thumbUrl: slide.url,
            type: 'design',
            category: 'شريط عرض الصور'
          });
        }
      }
    });

    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') {
        track.scrollBy({ left: -280, behavior: 'smooth' });
      } else if (e.key === 'ArrowLeft') {
        track.scrollBy({ left: 280, behavior: 'smooth' });
      }
    });
  }

  /* --------------------------------------------------------------------------
     21. تشغيل التطبيق بعد تحميل الصفحة
     -------------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    initNavigation();
    initScrollReveal();
    await initBrandLogo();
    await initProfilePhoto();
    initPortfolioFilters();
    updatePortfolioStats();
    renderPortfolio();
    initServicesFilter();
    initDropzone();
    initLightbox();
    initHologramStage();
    initVideoModal();
    initProjectModal();
    initDeleteModal();
    initBackupTools();
    initContactForm();
    await initRibbonShowcaseSlider();

    // تفعيل حماية التخزين المستديم للأعمال (حتى 200 صورة و 50 فيديو)
    await requestPersistentStorage();

    // مزامنة وعرض جميع الأعمال المحفوظة السابقة
    await syncAndLoadAllProjects();
  });

})();
