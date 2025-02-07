const express = require("express");
const fileUpload = require("express-fileupload");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const path = require("path");
const sharp = require("sharp");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware لتمكين رفع الملفات
app.use(fileUpload());

// خدمة الملفات الثابتة من مجلد assets
app.use("/assets", express.static(path.join(__dirname, "../assets")));

// صفحة الرفع
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "upload.html"));
});

// معالجة الرفع
app.post("/upload", async (req, res) => {
  if (!req.files || !req.files.zipFile) {
    return res.status(400).send("لم يتم رفع أي ملف.");
  }

  const zipFile = req.files.zipFile;
  const zip = new AdmZip(zipFile.data);
  const zipEntries = zip.getEntries(); // الحصول على الملفات داخل الـ ZIP

  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir); // إنشاء مجلد مؤقت لحفظ الصور المحولة

  const outputZipPath = path.join(__dirname, "converted_images.zip");
  const outputZip = new AdmZip(); // ملف ZIP جديد لتجميع الصور المحولة

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Image Links");

  // إضافة عناوين الأعمدة
  worksheet.columns = [
    { header: "اسم الصورة", key: "name", width: 30 },
    { header: "الرابط", key: "url", width: 50 },
    { header: "الحالة", key: "status", width: 20 },
  ];

  let progress = 0;
  const totalFiles = zipEntries.length;

  // إرسال التقدم إلى الواجهة
  const sendProgress = () => {
    io.emit("progress", { progress, totalFiles });
  };

  for (const [index, entry] of zipEntries.entries()) {
    if (!entry.isDirectory) {
      const ext = path.extname(entry.entryName).toLowerCase();
      const baseName = path.basename(entry.entryName, ext);
      const tempFilePath = path.join(tempDir, `${baseName}.jpeg`);
      const originalData = entry.getData();
      let status = "";

      if ([".jpeg", ".jpg"].includes(ext)) {
        // إذا كانت الصورة بالفعل بصيغة jpeg
        fs.writeFileSync(tempFilePath, originalData);
        status = "بالفعل JPEG";
      } else if ([".png", ".webp", ".gif"].includes(ext)) {
        // تحويل الصورة إلى صيغة jpeg
        await sharp(originalData)
          .jpeg()
          .toFile(tempFilePath);
        status = "تم تحويلها إلى JPEG";
      } else {
        status = "ليس صورة مدعومة";
        continue; // تجاوز الملفات غير المدعومة
      }

      const imageUrl = `https://app.dreamboxmalls.com/storage/app/public/product/${baseName}.jpeg`;
      worksheet.addRow({ name: entry.entryName, url: imageUrl, status });

      // إضافة الصورة المحولة إلى ملف ZIP
      outputZip.addLocalFile(tempFilePath);

      // تحديث التقدم
      progress = ((index + 1) / totalFiles) * 100;
      sendProgress();

      // إرسال بيانات الصورة إلى الواجهة
      io.emit("image-added", { name: entry.entryName, url: imageUrl, status });
    }
  }

  // حفظ ملف Excel
  const excelFilePath = path.join(__dirname, "image_links.xlsx");
  await workbook.xlsx.writeFile(excelFilePath);

  // إضافة ملف Excel إلى ملف ZIP
  outputZip.addLocalFile(excelFilePath);

  // كتابة ملف ZIP النهائي
  outputZip.writeZip(outputZipPath);

  // تنظيف المجلد المؤقت بعد انتهاء العملية
  fs.rmSync(tempDir, { recursive: true, force: true });

  // إرسال ملف ZIP للتنزيل
  res.download(outputZipPath, "converted_images.zip", (err) => {
    if (err) {
      console.error("خطأ أثناء تنزيل الملف:", err);
      res.status(500).send("حدث خطأ أثناء تنزيل الملف.");
    }

    // حذف ملف ZIP بعد التنزيل
    fs.unlinkSync(outputZipPath);
    fs.unlinkSync(excelFilePath);
  });
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`الخادم يعمل على http://localhost:${PORT}`);
});
