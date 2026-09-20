# GitHub Authentication Architecture

## الهدف
نقل التطبيق من:
browser -> Personal Access Token -> GitHub

إلى:
browser -> HttpOnly encrypted session cookie -> serverless GitHub proxy -> GitHub.

## ما تم تنفيذه
- OAuth Web Flow على الخادم.
- OAuth state للتحقق من الطلب.
- PKCE S256 لحماية authorization code flow.
- لا يوجد GitHub token في localStorage.
- لا يُرسل GitHub token إلى نموذج الذكاء الاصطناعي.
- جلسة stateless مشفرة بـ AES-GCM داخل HttpOnly Secure SameSite=Lax cookie.
- مدة الجلسة محدودة بزمن token.
- CSRF cookie + X-CSRF-Token + فحص Origin لكل عملية كتابة.
- GitHub proxy يسمح فقط بمسارات محددة: user, user repos/events, repos.
- الاستعراض العام محدود إلى مسارات users/repos/events/public للطلبات GET فقط.
- Logout يمسح session وCSRF وOAuth-state cookies.
- الوكيل لا يملك مسار merge تلقائي.

## المتغيرات المطلوبة على Vercel
- GITHUB_CLIENT_ID
- GITHUB_CLIENT_SECRET
- APP_URL
- SESSION_ENCRYPTION_KEY — يجب أن تكون 32 bytes بالضبط، بصيغة base64url أو 64 حرفًا hex.
- مفاتيح OpenAI تبقى في الخادم فقط.

## ملاحظة معمارية
الجلسة هنا stateless ومشفرة وليست مخزنة في قاعدة بيانات/Redis؛ لذلك لا يوجد اعتماد على ذاكرة Vercel serverless. المتصفح يحمل cookie مشفرة فقط، ولا يستطيع JavaScript قراءة محتواها.

## الصلاحيات
المرحلة الحالية تستخدم GitHub OAuth scope repo لأن الوكيل يحتاج قراءة وكتابة المستودعات. هذا أوسع من مبدأ أقل الصلاحيات. المسار الأقوى مستقبلًا هو GitHub App بصلاحيات مستودعات دقيقة وقصيرة العمر.

## الاختبارات المطلوبة قبل اعتبار الإصدار جاهزًا
1. OAuth login.
2. session restore بعد refresh.
3. logout وإبطال cookie.
4. قراءة المستودعات الخاصة.
5. كتابة آمنة مع CSRF.
6. رفض POST بدون CSRF.
7. رفض مسار GitHub غير allowlisted.
8. الاستعراض العام بدون session.
9. AI agent: READ/MODIFY/VERIFY/PR/CI.
10. CI أخضر على commit الإصدار.

لا يُعتبر المشروع مكتملًا نهائيًا حتى تنجح هذه الاختبارات على بيئة النشر الفعلية.