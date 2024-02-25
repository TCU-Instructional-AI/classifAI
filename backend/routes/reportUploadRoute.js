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
      const userId = req.params.userId;
      if (!userId) {
        return cb(new Error("No userId provided"), false);
      }
      const dir = path.join(__dirname, '..','uploads','.temporary_uploads', userId); //specify actual upload directory later
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
    cb(null, !!req.params.userId);
  }
});
//////////// 



//////////// POST Report endpoint: (optional file upload) Stores file in the web server, uploads info to MongoDB, sends to Workstation
///////// served on /reports/......
////// supports other optional attributes like subject, gradeLevel, and is_premium
router.post("/:reportId/users/:userId", upload.single('file'), async (req, res) => { 
    
    // Initialize the response structure
    let response = {
        flag: false,
        code: 500,
        message: '',
        data: {}
    };

    
    try {
        const { reportId, userId } = req.params;
        const providedFileName = req.body.fileName;

        if (!reportId){
            response.message = "reportId is required";
            response.code = 400;
            return res.status(400).json(response);
        }
        if (!userId){
            response.message = "userId is required";
            response.code = 400;
            return res.status(400).json(response);
        }

        // Check if a report with the given reportId for the userId already exists
        let existingReport = await dbconnect.getReportWhere({ userId: userId, reportId: reportId });
        if (existingReport) {
            // Report already exists, return an error
            response.message = "A report with the given report ID already exists for this user";
            response.code = 400; 
            return res.status(400).json(response); 
        }

        const reportData = {
            reportId: reportId,
            userId: userId,
            ...req.body, // includes other body data
        };    
        let report = await dbconnect.createReport(reportData);

        let newPath;

        // Update response for successful report processing
        response.flag = true;
        response.code = 200;
        response.message = req.file ? "File uploaded and database entry successfully created" : "Database entry successfully created without file upload";
        response.data = {
            userId: userId,
            reportId: reportId,
            file: req.file ? req.file.originalname : "No file uploaded",
            gradeLevel: req.body.gradeLevel,
            subject: req.body.subject
        };

        if (req.file){
            response.uploadStatus = 'pending';
            const allowedTypes = ['application/json', 'text/csv', 'application/pdf', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/webm'];
            if (!allowedTypes.includes(req.file.mimetype)) {
                await fsPromises.unlink(req.file.path);
                response.message = 'Invalid file type provided';
                response.uploadStatus = 'failed';
                return res.status(400).json(response);
            }

            const newDir = path.join('./uploads', userId, String(reportId));
            await fsPromises.mkdir(newDir, { recursive: true });
            newPath = await handleFileUpload(req, req.file.mimetype, userId, reportId, providedFileName, newDir);
            response.uploadStatus = 'successful';

            response.data.fileName= providedFileName || (newPath ? path.basename(newPath) : "No file uploaded");

            if (['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/webm'].includes(req.file.mimetype)) {
                
                try {

                    const transferResponse = await handleFileTransfer(`${process.env.WORKSTATION_URL}/transcription/start_transcription`, newPath, reportId);
                    response.transferStatus = 'successful';
                    const job_id = transferResponse.data.job_id; // Return job_id to the client for polling
                    let job = await getInitialJobReq(process.env.WORKSTATION_URL, job_id);
                    response.data.job_id = job_id; // Return job_id to the client
                    response.flag = true;
                    response.code = 200;
                    response.message = "File uploaded, database entry successfully, and transcription started";
                    
                    const {result, ...transferData} = job.transcriptionData; 

                    response.transferData = {
                        ...transferData, 
                        fileName: providedFileName || path.basename(newPath) 
                    };

                    // Update transferData for newest audioFile transfer
                    report.transferData= { ...transferData, fileName: providedFileName || path.basename(newPath) };
                    await dbconnect.updateReport({ userId, reportId }, { transferData: report.transferData, status: job.status, audioFile: providedFileName || path.basename(newPath) });
            
                } 
                catch (error) {
                    console.error("Error transfering file or updating report in the database:", error);
                    // Prepare an error response if updating the database fails
                    //response.flag = false;
                    //response.code = 500;
                    response.message = "Failed to transfer file";
                    response.transferStatus = 'failure';

                }
            }
        }
        
    

    res.status(200).json(response);

    }
    catch (error) {
        console.error(error);
        response.message = error.message || "An error occurred";

        response.uploadStatus = response.uploadStatus === 'pending' ? 'failed' : response.uploadStatus;  // if pending, change to failed, if not, leave as is
        response.transferStatus = (response.uploadStatus === 'successful' && response.transferStatus === 'pending') ? 'failed' : response.transferStatus;
        if (!res.headersSent) {
            res.status(500).json(response);
        }
    }
});





// Function to handle file upload and update report
const handleFileUpload = async (req, fileType, userId, reportId, providedFileName, newDir) => {
    const originalExtension = path.extname(req.file.originalname);
    let fileName = providedFileName ? providedFileName : path.basename(req.file.filename, originalExtension);
    let newPath = path.join(newDir, fileName + originalExtension);
    const oldPath = req.file.path;

    try {
        await fsPromises.rename(oldPath, newPath);
        const report = await dbconnect.getReportWhere({userId:userId, reportId: reportId});
         // Check if the report is not null
         if (!report) {
            throw new Error(`No report found with ID ${reportId}`);
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

        await dbconnect.updateReport({userId: userId, reportId: reportId}, { files: files });
        return newPath;
    } catch (error) {
        console.error("Error in moving file:", error);
        throw new Error("Failed to process file upload.");
    }
};


// Function to handle file transfer to flask backend
const handleFileTransfer = async (workstation, newPath, reportId) => {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(newPath));
    formData.append('reportId', String(reportId));

    try {
        const response = await axios.post(workstation, formData, { headers: formData.getHeaders() });
        return response;    
    } catch (error) {
        console.error("Error in file transfer:", error);
        throw new Error("Failed to transfer file. Possible Workstation connection error.");
    }
};


async function getInitialJobReq(workstationUrl, job_id) {
    let completed = false;
    let transcriptionData = null;

    const response = await axios.get(`${workstationUrl}/transcription/get_transcription_status`, {
        params: {
            job_id: job_id
        }
    });        
    transcriptionData = response.data;
    return { completed, transcriptionData };
}
//////////// 

module.exports = router;
