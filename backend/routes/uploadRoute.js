require('dotenv').config();
const express = require("express");
const multer = require('multer');
const axios = require("axios");
const fsPromises = require('fs').promises;
const fs = require('fs');  // For createReadStream, createWriteStream, etc.
const path = require('path');
const FormData = require('form-data');
const dbconnect = require('../mongo.js');
const router = express.Router();

//////////// Multer setup
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const userID = req.params.userID;
      if (!userID) {
        return cb(new Error("No userID provided"), false);
      }
      const dir = path.join(__dirname, '..','uploads','.temporary_uploads', userID); //specify actual upload directory later
      try {
        if (!fs.existsSync(dir)) {
          await fsPromises.mkdir(dir, { recursive: true });
        }
        cb(null, dir);
      } 
      catch (error) {
        console.error("Error creating directory:", error);
        cb(new Error("Failed to create upload directory."), false);
      }
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);//file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, !!req.params.userID);
  }
});
//////////// 



//////////// Upload endpoint: Stores file in the web server, uploads info to MongoDB, sends to Workstation
////// supports other optional attributes like subject, gradeLevel, and is_premium
router.post("/reports/:reportID/users/:userID", upload.single('file'), async (req, res) => {//"/", upload.single('file'), async (req, res) => {  // Ignore route, our server.js will serve this on /upload
    
    
    // 1/24 TODO: grab date of file upload, send to database

    // Initialize the response structure
    let response = {
        flag: false,
        code: 500,
        message: '',
        data: {}
    };

    
    try {
        const reportID = req.params.reportID;
        const userID = req.params.userID;
        const providedFileName = req.body.fileName;

        if (!req.file) {
            response.message = "File is required";
            return res.status(400).json(response);
        }
        if (!reportID){
            response.message = "reportID is required";
            return res.status(400).json(response);
        }
        if (!userID){
            response.message = "userID is required";
            return res.status(400).json(response);
        }



        const allowedTypes = ['application/json', 'text/csv', 'application/pdf', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/webm'];
        const audioTypes =['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/webm']
        const fileType = req.file.mimetype;
        if (!allowedTypes.includes(fileType)) {
            await fsPromises.unlink(req.file.path); 
            response.message = 'Invalid file type provided';
            return res.status(400).json(response);    
        }

        let report = await dbconnect.getReport(reportID);
        if (!report) {
            const reportData = {
                reportID: reportID,
                userID: userID,
                ...req.body, // includes other body data
            };    
            report = await dbconnect.createReport(reportData);

        }

        //let reportID = providedReportID || (await dbconnect.createReport(req.body)).reportID;
        const newDir = path.join('./uploads', userID, String(reportID)); // Place in uploads/userId/reportID/....... folder
        await fsPromises.mkdir(newDir, { recursive: true });
        let newPath = await handleFileUpload(req, fileType, reportID, providedFileName, newDir);
        
        // Set response for successful upload
        response.flag = true;
        response.code = 200;
        response.message = "File uploaded and database entry successfully created";
        response.data = {
            userId: userID,
            reportId: reportID,
            file: req.file.originalname,
            fileName: providedFileName || path.basename(newPath),
            gradeLevel: req.body.gradeLevel,
            subject: req.body.subject
        };

        if (!audioTypes.includes(fileType)) {
            //response.transferStatus = null;
            res.status(200).json(response);
        }
        else {
            await handleFileTransfer(process.env.WORKSTATION_URL, newPath, reportID);
                // 1/22 job_id = await handleFileTransfer(process.env.WORKSTATION_URL, newPath, reportID);
            response.transferStatus = 'successful';
            response.message = 'File uploaded, database entry sucessfully created, and file transferred successfully';
                // 1/22 response.job_id = job_id; 
            res.status(200).json(response);
        }

    }
    catch (error) {
        console.error(error);
        response.message = "An error occurred";
        response.uploadStatus = response.uploadStatus === 'pending' ? 'failed' : response.uploadStatus;  // if pending, change to failed, if not, leave as is
        response.transferStatus = (response.uploadStatus === 'successful' && response.transferStatus === 'pending') ? 'failed' : response.transferStatus;
        if (!res.headersSent) {
            res.status(500).json(response);
        }
    }
});


// Function to handle file upload and update report
const handleFileUpload = async (req, fileType, reportID, providedFileName, newDir) => {
    const originalExtension = path.extname(req.file.originalname);
    let fileName = providedFileName ? providedFileName : path.basename(req.file.filename, originalExtension);
    let newPath = path.join(newDir, fileName + originalExtension);
    const oldPath = req.file.path;

    try {
        await fsPromises.rename(oldPath, newPath);
        const report = await dbconnect.getReport(reportID);
         // Check if the report is not null
         if (!report) {
            throw new Error(`No report found with ID ${reportID}`);
        }
        let files = report.files || [];
        let existingFileIndex = files.findIndex(f => f.fileName === fileName);        

        if (existingFileIndex !== -1) {
            files[existingFileIndex] = {
                fileName: fileName,
                filePath: newPath,
                fileType: req.file.mimetype
            };
        } else {
            files.push({
                fileName: fileName,
                filePath: newPath,
                fileType: req.file.mimetype
            });        
        }

        await dbconnect.updateReport(reportID, { files: files });
        return newPath;
    } catch (error) {
        console.error("Error in moving file:", error);
        throw new Error("Failed to process file upload.");
    }
};


// Function to handle file transfer to flask backend
const handleFileTransfer = async (workstation, newPath, reportID) => {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(newPath));
    formData.append('reportID', String(reportID));

    try {
        await axios.post(workstation, formData, { headers: formData.getHeaders() });
    } catch (error) {
        console.error("Error in file transfer:", error);
        throw new Error("Failed to transfer file. Possible Workstation connection error.");
    }
};
//////////// 

module.exports = router;
