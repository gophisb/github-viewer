# GitHub Authentication Architecture

## الهدف
نقل التطبيق من:
browser -> Personal Access Token -> GitHub

إلى:
browser -> HttpOnly session -> serverless GitHub proxy -> GitHub.

## قواعد الأمان
- لا يُخزّن GitHub token في localStorage.
- لا يُرسل GitHub token إلى نموذج الذكاء الاصطناعي.
- OAuth state يُتحقق منه في callback.
- لا يُفعّل الإنتاج قبل وجود مخزن جلسات مشفر/موقّع.
- لا توجد صلاحيات merge تلقائية للوكيل.
- أقل صلاحيات GitHub ممكنة بعد تحديد العمليات المطلوبة.

## الحالة الحالية
هذه المرحلة تضيف حدود OAuth والـcallback بدون تغيير مسار GitHub الحالي، حتى لا تنكسر الوظائف العاملة.
الـcallback يتوقف عمدًا إذا لم توجد SESSION_ENCRYPTION_KEY؛ لا يُسمح بتسريب token إلى المتصفح.

## المتغيرات المطلوبة لاحقًا
- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET
- APP_URL
- SESSION_ENCRYPTION_KEY

## المرحلة التالية
1. إضافة جلسة مشفرة HttpOnly ذات مدة قصيرة.
2. إضافة /api/github/* proxy محدود بالعمليات.
3. إزالة github-viewer-token من localStorage.
4. تحويل githubFetch() في الواجهة إلى proxy.
5. اختبار login/logout/read/write وCSRF ثم CI.
