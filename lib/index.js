const express = require("express");
const fileUpload = require("express-fileupload");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const path = require("path");
const http = require("http");
const socketIo = require("socket.io");
const sharp = require("sharp");
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

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Image Links");

  // إضافة عناوين الأعمدة
  worksheet.columns = [
    { header: "اسم الصورة", key: "name", width: 30 },
    { header: "الرابط", key: "url", width: 50 },
  ];

  let progress = 0;
  const totalFiles = zipEntries.length;

  // إرسال التقدم إلى الواجهة
  const sendProgress = () => {
    io.emit("progress", { progress, totalFiles });
  };

  // إنشاء مجلد مؤقت لحفظ الصور المحولة
  const tempDir = path.join(__dirname, "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  // إنشاء ملف ZIP جديد للصور المحولة
  const convertedZip = new AdmZip();

  // إضافة البيانات مع تأخير
  for (let index = 0; index < zipEntries.length; index++) {
    const entry = zipEntries[index];
    if (!entry.isDirectory) {
      const imageName = entry.entryName;
      const imageBuffer = entry.getData();

      // تحويل الصورة إلى jpeg إذا لم تكن بالفعل
      const outputImageName = imageName.replace(/\.[^/.]+$/, ".jpeg");
      const outputImagePath = path.join(tempDir, outputImageName);

      try {
        await sharp(imageBuffer).jpeg().toFile(outputImagePath);

        // إضافة الصورة المحولة إلى ملف ZIP الجديد
        convertedZip.addLocalFile(outputImagePath, "", outputImageName);

        const imageUrl = `https://app.dreamboxmalls.com/storage/app/public/product/${outputImageName}`;
        worksheet.addRow({ name: outputImageName, url: imageUrl });

        // تحديث التقدم
        progress = ((index + 1) / totalFiles) * 100;
        sendProgress();

        // إرسال بيانات الصورة إلى الواجهة
        io.emit("image-added", { name: outputImageName, url: imageUrl });

        // تأخير لمحاكاة التقدم
        await new Promise((resolve) => setTimeout(resolve, 100)); // تأخير 100 مللي ثانية
      } catch (error) {
        console.error(`حدث خطأ أثناء تحويل الصورة ${imageName}:`, error);
      }
    }
  }

  // حفظ ملف Excel
  const excelFilePath = path.join(__dirname, "image_links.xlsx");
  await workbook.xlsx.writeFile(excelFilePath);

  // إضافة ملف Excel إلى ملف ZIP
  convertedZip.addLocalFile(excelFilePath, "", "image_links.xlsx");

  // حفظ ملف ZIP المحول
  const convertedZipPath = path.join(__dirname, "converted_images.zip");
  convertedZip.writeZip(convertedZipPath);

  // إرسال ملف ZIP المحول للتنزيل
  res.download(convertedZipPath, "converted_images.zip", (err) => {
    if (err) {
      console.error("حدث خطأ أثناء تنزيل الملف:", err);
      res.status(500).send("حدث خطأ أثناء تنزيل الملف.");
    }

    // حذف الملفات المؤقتة بعد الانتهاء
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(excelFilePath);
    fs.unlinkSync(convertedZipPath);
  });
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`الخادم يعمل على http://localhost:${PORT}`);
});