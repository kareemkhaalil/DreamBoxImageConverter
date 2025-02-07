const express = require("express");
const fileUpload = require("express-fileupload");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const app = express();
const server = require("http").Server(app);
const io = require("socket.io")(server);

// Middleware
app.use(fileUpload());
app.use(express.static("public"));

// Temporary folder for storing files
const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Handle file upload
app.post("/upload", async (req, res) => {
  try {
    if (!req.files || !req.files.zipFile) {
      return res.status(400).send("No files were uploaded.");
    }

    const zipFile = req.files.zipFile;
    const uploadPath = path.join(TEMP_DIR, zipFile.name);

    // Save uploaded file
    await zipFile.mv(uploadPath);

    // Extract files from ZIP
    const zip = new AdmZip(uploadPath);
    const entries = zip.getEntries();

    const convertedImages = [];
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Image Report");
    worksheet.columns = [
      { header: "Image Name", key: "name", width: 30 },
      { header: "Status", key: "status", width: 20 },
    ];

    const outputZip = new AdmZip();
    const outputDir = path.join(TEMP_DIR, `output_${Date.now()}`);
    fs.mkdirSync(outputDir);

    for (const entry of entries) {
      if (!entry.isDirectory) {
        const ext = path.extname(entry.entryName).toLowerCase();
        const baseName = path.basename(entry.entryName, ext);
        const outputFilePath = path.join(outputDir, `${baseName}.jpeg`);

        if ([".jpeg", ".jpg"].includes(ext)) {
          // Copy JPEG files directly
          fs.writeFileSync(outputFilePath, entry.getData());
          worksheet.addRow({ name: entry.entryName, status: "Already JPEG" });
          outputZip.addFile(`${baseName}.jpeg`, fs.readFileSync(outputFilePath));
        } else if ([".png", ".webp", ".gif"].includes(ext)) {
          // Convert non-JPEG images to JPEG
          await sharp(entry.getData())
            .jpeg()
            .toFile(outputFilePath);
          worksheet.addRow({ name: entry.entryName, status: "Converted to JPEG" });
          outputZip.addFile(`${baseName}.jpeg`, fs.readFileSync(outputFilePath));
        } else {
          // Unsupported file format
          worksheet.addRow({ name: entry.entryName, status: "Unsupported format" });
        }
      }

      // Emit progress
      io.emit("progress", { file: entry.entryName });
    }

    // Save the ZIP and Excel files
    const zipOutputPath = path.join(TEMP_DIR, "converted_images.zip");
    const excelOutputPath = path.join(TEMP_DIR, "image_report.xlsx");
    outputZip.writeZip(zipOutputPath);
    await workbook.xlsx.writeFile(excelOutputPath);

    // Clean up the uploaded ZIP file
    fs.unlinkSync(uploadPath);

    res.json({
      zipUrl: `/download/zip`,
      excelUrl: `/download/excel`,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send("An error occurred during processing.");
  }
});

// Serve download endpoints
app.get("/download/zip", (req, res) => {
  const zipOutputPath = path.join(TEMP_DIR, "converted_images.zip");
  res.download(zipOutputPath, "converted_images.zip", () => {
    fs.unlinkSync(zipOutputPath);
  });
});

app.get("/download/excel", (req, res) => {
  const excelOutputPath = path.join(TEMP_DIR, "image_report.xlsx");
  res.download(excelOutputPath, "image_report.xlsx", () => {
    fs.unlinkSync(excelOutputPath);
  });
});

// Socket.IO connection
io.on("connection", (socket) => {
  console.log("Client connected");

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
