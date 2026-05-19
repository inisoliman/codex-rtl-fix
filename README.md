# Codex RTL Arabic Fix

أداة صغيرة لنظام Windows تساعد على تحسين عرض النص العربي المختلط مع الإنجليزي داخل تطبيق Codex Desktop، بدون قلب واجهة Codex بالكامل إلى RTL.

الفكرة ببساطة: Codex واجهته الأساسية LTR، وهذا مناسب للأزرار والقوائم ومسارات الملفات والكود. لكن عند كتابة أو قراءة عربي مختلط مع English، قد يظهر ترتيب الكلمات أو علامات الترقيم بشكل غير مريح. هذه الأداة تضيف طبقة RTL ذكية على مناطق النص فقط مثل الرسائل ومربع الكتابة وبعض مخرجات الطرفية.

> هذه الأداة غير رسمية وليست تابعة لـ OpenAI. استخدم مسار التثبيت الدائم بحذر لأنه يعدل ملف `app.asar` داخل تطبيق Codex المثبت.

## ما الذي تصلحه الأداة؟

- تضبط اتجاه النص العربي تلقائيًا باستخدام `dir="auto"`.
- تستخدم `unicode-bidi: plaintext` لتحسين ترتيب العربي والإنجليزي في نفس السطر.
- تترك واجهة Codex نفسها كما هي LTR حتى لا تنقلب الأزرار والقوائم والتخطيط.
- تستثني كتل الكود وinline code والمسارات التقنية قدر الإمكان.
- تعمل على الرسائل الجديدة أيضًا باستخدام `MutationObserver`.

مثال نص مستهدف:

```text
Hello صديقي كيف حالك today?
C:\Users\helen\file.txt
```

الأداة تحاول تحسين السطر العربي المختلط بدون إفساد مسارات Windows أو الكود.

## الملفات

```text
.
+-- START_CODEX_WITH_RTL_FIX_DETACHED.cmd
+-- launch-codex-with-rtl-injection.ps1
+-- inject-rtl-via-cdp.mjs
+-- rtl-runtime-fix.js
+-- APPLY_TO_INSTALLED_CODEX_AS_ADMIN.cmd
+-- apply-to-installed-codex-as-admin.ps1
+-- patch-codex-rtl.mjs
+-- verify-installed-rtl-patch.ps1
+-- RESTORE_CODEX_ORIGINAL_AS_ADMIN.cmd
+-- restore-installed-codex-as-admin.ps1
+-- debug-codex-rtl-cdp.mjs
+-- inspect-arabic-dom-cdp.mjs
```

## المتطلبات

- Windows.
- تطبيق Codex Desktop مثبت.
- Node.js متاح من الأمر `node`.
  - غالبًا يكفي تثبيت Node.js العادي.
  - بعض نسخ Codex تحتوي أيضًا على `node.exe` داخل مجلد التطبيق.
- PowerShell.

للتحقق من Node:

```powershell
node --version
```

## طريقة الاستخدام الموصى بها: التشغيل الآمن

هذه الطريقة لا تعدل ملفات Codex المثبتة. هي تفتح Codex مع منفذ DevTools محلي، ثم تحقن إصلاح RTL في الواجهة الحالية.

شغّل:

```cmd
START_CODEX_WITH_RTL_FIX_DETACHED.cmd
```

أو من PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch-codex-with-rtl-injection.ps1
```

إذا كان المنفذ `9333` مشغولًا:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch-codex-with-rtl-injection.ps1 -Port 9334
```

إذا كان Codex مفتوحًا بالفعل بمنفذ DevTools وتريد الحقن فقط:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch-codex-with-rtl-injection.ps1 -InjectOnly
```

ملاحظات:

- هذا المسار هو الأكثر أمانًا.
- تحتاج تشغيله بدل فتح Codex من Start Menu عندما تريد إصلاح RTL.
- السكربت قد يغلق Codex المفتوح ثم يعيد فتحه مع إعدادات DevTools.

## طريقة اختيارية: التثبيت الدائم

هذه الطريقة تعدل ملف `app.asar` داخل Codex المثبت بعد أخذ نسخة احتياطية. بعدها يمكنك فتح Codex طبيعيًا من Start Menu.

شغّل كمسؤول:

```cmd
APPLY_TO_INSTALLED_CODEX_AS_ADMIN.cmd
```

أو:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\apply-to-installed-codex-as-admin.ps1 -RepairAcl
```

ما الذي يحدث؟

1. يحاول السكربت العثور على Codex المثبت.
2. يغلق عمليات Codex المفتوحة.
3. يأخذ نسخة احتياطية من `app.asar`.
4. ينسخ الملف إلى مجلد عمل مؤقت.
5. يضيف `rtl-runtime-fix.js` داخل entrypoint الخاص بواجهة Codex.
6. يستبدل `app.asar` المثبت.
7. يشغل التحقق عبر `verify-installed-rtl-patch.ps1`.

مكان النسخ الاحتياطية يكون عادة داخل:

```text
installed-app-backups\<timestamp>\app.asar.before-installed-patch
```

تحذيرات مهمة:

- تحديث Codex قد يستبدل `app.asar` ويزيل الإصلاح.
- قد تحتاج إعادة تطبيق الأداة بعد تحديث Codex.
- WindowsApps محمي بصلاحيات خاصة، لذلك قد تحتاج `-RepairAcl`.
- إذا لم تكن مرتاحًا لتعديل ملفات التطبيق، استخدم طريقة التشغيل الآمن فقط.

## الاستعادة من نسخة احتياطية

إذا أردت الرجوع للنسخة الأصلية:

```cmd
RESTORE_CODEX_ORIGINAL_AS_ADMIN.cmd
```

سيختار هذا الأمر أحدث نسخة احتياطية تلقائيًا من مجلد `installed-app-backups`.

وإذا أردت تحديد نسخة احتياطية بعينها:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\restore-installed-codex-as-admin.ps1 -BackupAsarPath "installed-app-backups\<timestamp>\app.asar.before-installed-patch" -RepairAcl
```

استبدل `<timestamp>` باسم مجلد النسخة الاحتياطية الحقيقي.

## التحقق اليدوي

للتحقق من أن `app.asar` يحتوي التصحيح:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-installed-rtl-patch.ps1
```

أو على ملف محدد:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify-installed-rtl-patch.ps1 -AsarPath "path\to\app.asar"
```

للتحقق من أن patcher يستطيع قراءة ملف Codex بدون تعديل:

```powershell
node .\patch-codex-rtl.mjs --asar "C:\Path\To\app.asar" --dry-run
```

للتشخيص إذا كان التشغيل الآمن لا يؤثر بصريًا:

```powershell
node .\debug-codex-rtl-cdp.mjs 9333
node .\inspect-arabic-dom-cdp.mjs 9333
```

الأول يتأكد أن runtime موجود داخل Codex ويعرض عدد العناصر المصححة، والثاني يعرض عينة من عناصر DOM التي تحتوي نصًا عربيًا.

## كيف تعمل تقنيًا؟

### مسار التشغيل الآمن

`launch-codex-with-rtl-injection.ps1` يشغل Codex مع:

```text
--remote-debugging-port=9333
```

ثم يستدعي:

```text
inject-rtl-via-cdp.mjs
```

هذا الملف يتصل بـ Chrome DevTools Protocol على:

```text
http://127.0.0.1:9333/json/list
```

ثم يحقن محتوى:

```text
rtl-runtime-fix.js
```

داخل webview الخاص بـ Codex.

### مسار التثبيت الدائم

`patch-codex-rtl.mjs` يقرأ بنية `app.asar` مباشرة بدون الاعتماد على حزمة npm خارجية، ثم:

- يقرأ `webview/index.html`.
- يجد ملف JavaScript الرئيسي للواجهة.
- يضيف runtime fix في نهاية ذلك الملف.
- يعيد بناء offsets داخل `app.asar`.
- يحدّث integrity للملف المعدّل.

العلامة المستخدمة لتجنب تكرار الحقن:

```text
codex-rtl-runtime-fix v1
```

إذا كانت العلامة موجودة، لن يضيف patch جديدًا مرة ثانية.

## ما الذي لا تفعله الأداة؟

- لا تترجم واجهة Codex إلى العربية.
- لا تجعل كل التطبيق RTL.
- لا تغير منطق Codex أو النماذج أو المحادثات.
- لا تضمن إصلاح كل عنصر واجهة في كل إصدار مستقبلي من Codex.
- لا تعدل كتل الكود عمدًا، لأن تغيير اتجاه الكود غالبًا يسبب مشاكل أكثر مما يحل.

## استكشاف الأخطاء

### Could not reach Codex DevTools

السبب غالبًا أن Codex لم يبدأ بمنفذ DevTools، أو أن المنفذ مشغول.

جرب:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch-codex-with-rtl-injection.ps1 -Port 9334
```

### Could not find node.exe

ثبت Node.js أو تأكد أن الأمر التالي يعمل:

```powershell
node --version
```

### Windows blocked writing to app.asar

استخدم سكربت Admin:

```cmd
APPLY_TO_INSTALLED_CODEX_AS_ADMIN.cmd
```

أو شغّل:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\apply-to-installed-codex-as-admin.ps1 -RepairAcl
```

### RTL اختفى بعد تحديث Codex

هذا طبيعي في مسار التثبيت الدائم. أعد تشغيل سكربت التثبيت الدائم، أو استخدم المشغّل الآمن.

### النص العربي ما زال لا يظهر كما تريد

افتح issue وضع:

- إصدار Codex.
- مثال نص بسيط يوضح المشكلة.
- هل المشكلة في الرسائل أم مربع الكتابة أم terminal؟
- هل استخدمت التشغيل الآمن أم التثبيت الدائم؟

## اختبار سريع بعد التشغيل

بعد تشغيل الأداة، جرّب كتابة هذه الجملة في Codex:

```text
Hello صديقي كيف حالك today?
```

وجرّب أيضًا نصًا تقنيًا:

```text
افتح الملف C:\Users\helen\Downloads\test.txt ثم شغّل npm run dev
```

المفروض أن العربي المختلط يتحسن، بينما الكود والمسارات تبقى قابلة للقراءة.

## المساهمة

المساهمات مرحب بها، خصوصًا في:

- تحسين selectors الخاصة بمناطق الرسائل في إصدارات Codex الجديدة.
- إضافة اختبارات أكثر على نصوص عربية وإنجليزية مختلطة.
- تحسين التعامل مع terminal بدون التأثير على الكود.
- إضافة صور قبل/بعد في README.

عند فتح Pull Request، اذكر:

- إصدار Codex الذي اختبرت عليه.
- هل اختبرت التشغيل الآمن أم التثبيت الدائم؟
- مثال نص قبل/بعد إن أمكن.

## ملاحظة قانونية

هذه أداة مجتمعية غير رسمية. تعديل ملفات التطبيقات المثبتة قد لا يكون مناسبًا لكل المستخدمين أو كل البيئات. استخدمها على مسؤوليتك، واحتفظ دائمًا بنسخة احتياطية قبل استخدام التثبيت الدائم.
