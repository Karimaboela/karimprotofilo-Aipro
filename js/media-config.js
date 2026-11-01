/**
 * ==========================================================================
 * كريم محمود - إعدادات وتكامل الوسائط واستبدال الفيديوهات المحلية بـ YouTube Embed
 * مهيأ بالكامل للنشر مع الحفاظ التام على أسماء الملفات الأصلية وجودة 1080p
 * ==========================================================================
 */

(function (window) {
  'use strict';

  /**
   * جدول مطابقة الفيديوهات المحلية بروابط YouTube المضمنة (YouTube Embed)
   * مع الحفاظ الكامل على أسماء الملفات الأصلية وخصائص Autoplay و Loop و Full HD
   */
  var LOCAL_VIDEO_TO_YOUTUBE_MAP = {
    'dr-awad-iron-deficiency.mp4': {
      title: 'د. عوض - أعراض وعلاج نقص الحديد',
      desc: 'فيديو توعوي طبي بالذكاء الاصطناعي عن أعراض وعلاج نقص الحديد والأنيميا',
      fileName: 'dr-awad-iron-deficiency.mp4',
      localPath: 'assets/videos/dr-awad-iron-deficiency.mp4',
      ytId: 'fCuugxpXVo0',
      embedUrl: 'https://www.youtube.com/embed/fCuugxpXVo0?autoplay=1&loop=1&playlist=fCuugxpXVo0&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=fCuugxpXVo0',
      thumb: 'https://img.youtube.com/vi/fCuugxpXVo0/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-mohamed-shtiwi-inguinal-hernia.mp4': {
      title: 'د. محمد سعد شتيوي - الفتق الإربي عند الأطفال',
      desc: 'فيديو توعوي جراحي بالذكاء الاصطناعي حول جراحة الفتق الإربي للأطفال',
      fileName: 'dr-mohamed-shtiwi-inguinal-hernia.mp4',
      localPath: 'assets/videos/dr-mohamed-shtiwi-inguinal-hernia.mp4',
      ytId: 'n5wTsINvyRU',
      embedUrl: 'https://www.youtube.com/embed/n5wTsINvyRU?autoplay=1&loop=1&playlist=n5wTsINvyRU&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=n5wTsINvyRU',
      thumb: 'https://img.youtube.com/vi/n5wTsINvyRU/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-mohamed-shtiwi-hernia.mp4': {
      title: 'د. محمد شتيوي - أسباب وعلاج الفتق الجراحي',
      desc: 'محتوى طبي ثلاثي الأبعاد عن أسباب وعلاج الفتق الجراحي والترميم',
      fileName: 'dr-mohamed-shtiwi-hernia.mp4',
      localPath: 'assets/videos/dr-mohamed-shtiwi-hernia.mp4',
      ytId: 'EMMJPD8v4Pw',
      embedUrl: 'https://www.youtube.com/embed/EMMJPD8v4Pw?autoplay=1&loop=1&playlist=EMMJPD8v4Pw&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=EMMJPD8v4Pw',
      thumb: 'https://img.youtube.com/vi/EMMJPD8v4Pw/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-hesham-local-anesthesia.mp4': {
      title: 'د. هشام - إجراءات العمليات بالبنج الموضعي',
      desc: 'فيديو طبي توعوي عن إجراءات عمليات السمنة والمناظير بالبنج الموضعي',
      fileName: 'dr-hesham-local-anesthesia.mp4',
      localPath: 'assets/videos/dr-hesham-local-anesthesia.mp4',
      ytId: '78HvfJvaiQs',
      embedUrl: 'https://www.youtube.com/embed/78HvfJvaiQs?autoplay=1&loop=1&playlist=78HvfJvaiQs&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=78HvfJvaiQs',
      thumb: 'https://img.youtube.com/vi/78HvfJvaiQs/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-hesham-october-victory.mp4': {
      title: 'د. هشام - تهنئة نصر أكتوبر المجيد',
      desc: 'عمل وثائقي وموشن جرافيك بمناسبة ذكرى انتصارات حرب أكتوبر المجيدة',
      fileName: 'dr-hesham-october-victory.mp4',
      localPath: 'assets/videos/dr-hesham-october-victory.mp4',
      ytId: '_KvUTGUPJEo',
      embedUrl: 'https://www.youtube.com/embed/_KvUTGUPJEo?autoplay=1&loop=1&playlist=_KvUTGUPJEo&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=_KvUTGUPJEo',
      thumb: 'https://img.youtube.com/vi/_KvUTGUPJEo/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-amira-lashin-veneers.mp4': {
      title: 'د. أميرة لاشين - ابتسامة هوليوود والفينيرز',
      desc: 'فيديو إعلاني تجميلي لطب الأسنان والفينيرز بالذكاء الاصطناعي',
      fileName: 'dr-amira-lashin-veneers.mp4',
      localPath: 'assets/videos/dr-amira-lashin-veneers.mp4',
      ytId: 'AgxCnGoDA34',
      embedUrl: 'https://www.youtube.com/embed/AgxCnGoDA34?autoplay=1&loop=1&playlist=AgxCnGoDA34&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=AgxCnGoDA34',
      thumb: 'https://img.youtube.com/vi/AgxCnGoDA34/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-awad-kefaya.mp4': {
      title: 'د. عوض - كفاية عادات غذائية خاطئة',
      desc: 'فيديو توعوي تفاعلي بأسلوب الذكاء الاصطناعي لتصحيح العادات الغذائية',
      fileName: 'dr-awad-kefaya.mp4',
      localPath: 'assets/videos/dr-awad-kefaya.mp4',
      ytId: 'E8vucnOiUPE',
      embedUrl: 'https://www.youtube.com/embed/E8vucnOiUPE?autoplay=1&loop=1&playlist=E8vucnOiUPE&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=E8vucnOiUPE',
      thumb: 'https://img.youtube.com/vi/E8vucnOiUPE/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-awad-omega3.mp4': {
      title: 'د. عوض البنداري - فوائد أوميجا 3 للصحة والقلب',
      desc: 'فيديو تثقيفي دوائي وصحي يشرح الأهمية الحيوية لأوميجا 3 للأوعية الدموية',
      fileName: 'dr-awad-omega3.mp4',
      localPath: 'assets/videos/dr-awad-omega3.mp4',
      ytId: '_CCFQ8r6EpU',
      embedUrl: 'https://www.youtube.com/embed/_CCFQ8r6EpU?autoplay=1&loop=1&playlist=_CCFQ8r6EpU&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=_CCFQ8r6EpU',
      thumb: 'https://img.youtube.com/vi/_CCFQ8r6EpU/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-mohamed-shtiwi-hiatal-hernia.mp4': {
      title: 'د. محمد سعد شتيوي - جراحة فتق الحجاب الحاجز',
      desc: 'شرح طبي جراحي متقدم لعلاج وفتق الحجاب الحاجز بالمنظار',
      fileName: 'dr-mohamed-shtiwi-hiatal-hernia.mp4',
      localPath: 'assets/videos/dr-mohamed-shtiwi-hiatal-hernia.mp4',
      ytId: 'Do4md4sQUSQ',
      embedUrl: 'https://www.youtube.com/embed/Do4md4sQUSQ?autoplay=1&loop=1&playlist=Do4md4sQUSQ&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=Do4md4sQUSQ',
      thumb: 'https://img.youtube.com/vi/Do4md4sQUSQ/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-hesham-installments.mp4': {
      title: 'د. هشام - أنظمة التقسيط الميسرة للعمليات',
      desc: 'إعلان موشن جرافيك وفيديو ترويجي لأنظمة تقسيط العمليات الجراحية',
      fileName: 'dr-hesham-installments.mp4',
      localPath: 'assets/videos/dr-hesham-installments.mp4',
      ytId: 'o7yO6OBHsoU',
      embedUrl: 'https://www.youtube.com/embed/o7yO6OBHsoU?autoplay=1&loop=1&playlist=o7yO6OBHsoU&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=o7yO6OBHsoU',
      thumb: 'https://img.youtube.com/vi/o7yO6OBHsoU/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'saeed-shehata-sadat.mp4': {
      title: 'وثائقي الذكاء الاصطناعي - سعيد شحاتة سادات',
      desc: 'إنتاج وثائقي وسرد تاريخي بصري متقدم ومؤثرات بالذكاء الاصطناعي',
      fileName: 'saeed-shehata-sadat.mp4',
      localPath: 'assets/videos/saeed-shehata-sadat.mp4',
      ytId: 'CZ5ktC5x5S0',
      embedUrl: 'https://www.youtube.com/embed/CZ5ktC5x5S0?autoplay=1&loop=1&playlist=CZ5ktC5x5S0&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=CZ5ktC5x5S0',
      thumb: 'https://img.youtube.com/vi/CZ5ktC5x5S0/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'dr-mohamed-shtiwi-hernia-repair.mp4': {
      title: 'د. محمد سعد شتيوي - جراحة الفتق بالمنظار',
      desc: 'فيديو ثلاثي الأبعاد عن تقنيات إصلاح الفتق الجراحي بالمناظير الحديثة',
      fileName: 'dr-mohamed-shtiwi-hernia-repair.mp4',
      localPath: 'assets/videos/dr-mohamed-shtiwi-hernia-repair.mp4',
      ytId: 'I1H1cXSF2tA',
      embedUrl: 'https://www.youtube.com/embed/I1H1cXSF2tA?autoplay=1&loop=1&playlist=I1H1cXSF2tA&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=I1H1cXSF2tA',
      thumb: 'https://img.youtube.com/vi/I1H1cXSF2tA/maxresdefault.jpg',
      aspectRatio: '9:16'
    },
    'yalla-tager-1.mp4': {
      title: 'فيديو إعلاني موشن بالذكاء الاصطناعي - يلا تاجر',
      desc: 'فيديو تسويقي إعلاني احترافي لمنصة تجارة إلكترونية بتوليد الذكاء الاصطناعي',
      fileName: 'yalla-tager-1.mp4',
      localPath: 'assets/videos/yalla-tager-1.mp4',
      ytId: '1Hm19HoNowM',
      embedUrl: 'https://www.youtube.com/embed/1Hm19HoNowM?autoplay=1&loop=1&playlist=1Hm19HoNowM&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
      watchUrl: 'https://www.youtube.com/watch?v=1Hm19HoNowM',
      thumb: 'https://img.youtube.com/vi/1Hm19HoNowM/maxresdefault.jpg',
      aspectRatio: '9:16'
    }
  };

  var CLOUDINARY_CONFIG = {
    cloudName: 'karim-portfolio',
    enabled: false,
    baseFolder: 'portfolio',
    customUrls: {}
  };

  var CLOUDINARY_MEDIA_MAP = {
    // =========================================================================
    // 1. الفيديوهات (مطابقة بالكامل بروابط YouTube Embed المباشرة)
    // =========================================================================
    'assets/videos/dr-awad-iron-deficiency.mp4': 'https://www.youtube.com/embed/fCuugxpXVo0?autoplay=1&loop=1&playlist=fCuugxpXVo0&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-mohamed-shtiwi-inguinal-hernia.mp4': 'https://www.youtube.com/embed/n5wTsINvyRU?autoplay=1&loop=1&playlist=n5wTsINvyRU&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-mohamed-shtiwi-hernia.mp4': 'https://www.youtube.com/embed/EMMJPD8v4Pw?autoplay=1&loop=1&playlist=EMMJPD8v4Pw&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-hesham-local-anesthesia.mp4': 'https://www.youtube.com/embed/78HvfJvaiQs?autoplay=1&loop=1&playlist=78HvfJvaiQs&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-hesham-october-victory.mp4': 'https://www.youtube.com/embed/_KvUTGUPJEo?autoplay=1&loop=1&playlist=_KvUTGUPJEo&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-amira-lashin-veneers.mp4': 'https://www.youtube.com/embed/AgxCnGoDA34?autoplay=1&loop=1&playlist=AgxCnGoDA34&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-awad-kefaya.mp4': 'https://www.youtube.com/embed/E8vucnOiUPE?autoplay=1&loop=1&playlist=E8vucnOiUPE&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-awad-omega3.mp4': 'https://www.youtube.com/embed/_CCFQ8r6EpU?autoplay=1&loop=1&playlist=_CCFQ8r6EpU&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-mohamed-shtiwi-hiatal-hernia.mp4': 'https://www.youtube.com/embed/Do4md4sQUSQ?autoplay=1&loop=1&playlist=Do4md4sQUSQ&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-hesham-installments.mp4': 'https://www.youtube.com/embed/o7yO6OBHsoU?autoplay=1&loop=1&playlist=o7yO6OBHsoU&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/saeed-shehata-sadat.mp4': 'https://www.youtube.com/embed/CZ5ktC5x5S0?autoplay=1&loop=1&playlist=CZ5ktC5x5S0&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/dr-mohamed-shtiwi-hernia-repair.mp4': 'https://www.youtube.com/embed/I1H1cXSF2tA?autoplay=1&loop=1&playlist=I1H1cXSF2tA&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',
    'assets/videos/yalla-tager-1.mp4': 'https://www.youtube.com/embed/1Hm19HoNowM?autoplay=1&loop=1&playlist=1Hm19HoNowM&playsinline=1&enablejsapi=1&rel=0&modestbranding=1&hd=1&vq=hd1080',

    // =========================================================================
    // 2. التصميمات الطبية (42 تصميم - الحجم: 151.57 ميجابايت)
    // =========================================================================
    'assets/images/designs/medical-design-01.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-01.png',
    'assets/images/designs/medical-design-02.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-02.png',
    'assets/images/designs/medical-design-03.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-03.png',
    'assets/images/designs/medical-design-04.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-04.png',
    'assets/images/designs/medical-design-05.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-05.png',
    'assets/images/designs/medical-design-06.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-06.png',
    'assets/images/designs/medical-design-07.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-07.png',
    'assets/images/designs/medical-design-08.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-08.png',
    'assets/images/designs/medical-design-09.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-09.png',
    'assets/images/designs/medical-design-10.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-10.png',
    'assets/images/designs/medical-design-11.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-11.png',
    'assets/images/designs/medical-design-12.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-12.png',
    'assets/images/designs/medical-design-13.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-13.png',
    'assets/images/designs/medical-design-14.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-14.png',
    'assets/images/designs/medical-design-15.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-15.png',
    'assets/images/designs/medical-design-16.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-16.png',
    'assets/images/designs/medical-design-17.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-17.png',
    'assets/images/designs/medical-design-18.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-18.png',
    'assets/images/designs/medical-design-19.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-19.png',
    'assets/images/designs/medical-design-20.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-20.png',
    'assets/images/designs/medical-design-21.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-21.png',
    'assets/images/designs/medical-design-22.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-22.png',
    'assets/images/designs/medical-design-23.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-23.png',
    'assets/images/designs/medical-design-24.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-24.png',
    'assets/images/designs/medical-design-25.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-25.png',
    'assets/images/designs/medical-design-26.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-26.png',
    'assets/images/designs/medical-design-27.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-27.png',
    'assets/images/designs/medical-design-28.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-28.png',
    'assets/images/designs/medical-design-29.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-29.png',
    'assets/images/designs/medical-design-30.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-30.png',
    'assets/images/designs/medical-design-31.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-31.png',
    'assets/images/designs/medical-design-32.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-32.png',
    'assets/images/designs/medical-design-33.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-33.png',
    'assets/images/designs/medical-design-34.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-34.png',
    'assets/images/designs/medical-design-35.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-35.png',
    'assets/images/designs/medical-design-36.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-36.png',
    'assets/images/designs/medical-design-37.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-37.png',
    'assets/images/designs/medical-design-38.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-38.png',
    'assets/images/designs/medical-design-39.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-39.png',
    'assets/images/designs/medical-design-40.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-40.png',
    'assets/images/designs/medical-design-41.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-41.png',
    'assets/images/designs/medical-design-42.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/designs/medical-design-42.png',

    // =========================================================================
    // 3. صورة الهوية والشعار الشخصي (الحجم: 2.09 ميجابايت)
    // =========================================================================
    'assets/images/tech-explorer-robot.png': 'https://res.cloudinary.com/karim-portfolio/image/upload/f_auto,q_auto/v1/portfolio/images/tech-explorer-robot.png',

    // =========================================================================
    // 4. المقاطع الصوتية (2 عينة صوتية - الحجم: 7.07 ميجابايت)
    // =========================================================================
    'assets/audio/voiceover-sample-1.wav': 'https://res.cloudinary.com/karim-portfolio/video/upload/v1/portfolio/audio/voiceover-sample-1.wav',
    'assets/audio/voiceover-sample-2.wav': 'https://res.cloudinary.com/karim-portfolio/video/upload/v1/portfolio/audio/voiceover-sample-2.wav'
  };

  /**
   * دالة التحويل الذكية للمسار (Media URL Resolver)
   * تعيد تلقائياً رابط YouTube Embed لأي ملف فيديو محلي مطابق
   * 
   * @param {string} path مسار الملف المحلي أو الرابط
   * @returns {string} الرابط النهائي للاستخدام
   */
  function resolveMediaUrl(path) {
    if (!path || typeof path !== 'string') return path;

    var cleanPath = path.replace(/\\/g, '/').replace(/^\.\//, '');
    var fileName = cleanPath.split('/').pop();

    // 1. فحص مطابقة الفيديو المحلي بـ YouTube Embed (أولوية مطلقة للفيديوهات)
    if (LOCAL_VIDEO_TO_YOUTUBE_MAP[fileName]) {
      return LOCAL_VIDEO_TO_YOUTUBE_MAP[fileName].embedUrl;
    }
    if (LOCAL_VIDEO_TO_YOUTUBE_MAP[cleanPath]) {
      return LOCAL_VIDEO_TO_YOUTUBE_MAP[cleanPath].embedUrl;
    }

    // إذا كان الرابط خارجياً بالفعل أو Blob أو DataURL نُرجعه فوراً كما هو
    if (/^(https?:|\/\/|data:|blob:)/i.test(path)) {
      return path;
    }

    // 2. فحص وجود رابط مخصص في customUrls
    if (CLOUDINARY_CONFIG.customUrls && CLOUDINARY_CONFIG.customUrls[cleanPath]) {
      return CLOUDINARY_CONFIG.customUrls[cleanPath];
    }

    // 3. فحص وجود الملف في جدول الروابط الافتراضي
    if (CLOUDINARY_MEDIA_MAP[cleanPath]) {
      var mappedUrl = CLOUDINARY_MEDIA_MAP[cleanPath];
      if (mappedUrl.indexOf('youtube.com') !== -1) {
        return mappedUrl;
      }
      if (CLOUDINARY_CONFIG.enabled) {
        var cloud = (CLOUDINARY_CONFIG.cloudName || '').trim();
        if (cloud && cloud !== 'karim-portfolio') {
          return mappedUrl.replace('/karim-portfolio/', '/' + encodeURIComponent(cloud) + '/');
        }
        return mappedUrl;
      }
    }

    // 4. إذا لم يكن كلاوديناري مفعلاً لباقي الوسائط، العودة للمسار المحلي
    if (!CLOUDINARY_CONFIG.enabled) {
      return cleanPath;
    }

    var cloudName = (CLOUDINARY_CONFIG.cloudName || '').trim();
    if (!cloudName) {
      return cleanPath;
    }

    var ext = cleanPath.split('.').pop().toLowerCase();
    var isVideo = ['mp4', 'webm', 'mov', 'avi', 'mkv'].indexOf(ext) !== -1;
    var isAudio = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].indexOf(ext) !== -1;
    var resourceType = (isVideo || isAudio) ? 'video' : 'image';
    var transform = isAudio ? '' : 'f_auto,q_auto/';
    var subPath = cleanPath.replace(/^assets\//, '');
    var base = CLOUDINARY_CONFIG.baseFolder ? (CLOUDINARY_CONFIG.baseFolder + '/') : '';

    return 'https://res.cloudinary.com/' + encodeURIComponent(cloudName) + '/' + resourceType + '/upload/' + transform + 'v1/' + base + subPath;
  }

  // تصدير للكائنات العامة
  window.LOCAL_VIDEO_TO_YOUTUBE_MAP = LOCAL_VIDEO_TO_YOUTUBE_MAP;
  window.CLOUDINARY_CONFIG = CLOUDINARY_CONFIG;
  window.CLOUDINARY_MEDIA_MAP = CLOUDINARY_MEDIA_MAP;
  window.resolveMediaUrl = resolveMediaUrl;

})(window);
