require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

const app = express();
app.use(express.json({ limit: '50mb' })); 
app.use(cors());
app.use(express.static('public')); 

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch(err => console.error("MongoDB error:", err));

// --- SCHEMAS ---
const userSchema = new mongoose.Schema({
  name: String,
  phone: { type: String, unique: true }, 
  password: String,
  role: String, 
  specialization: String, 
  profilePicUrl: String,
  clinicName: { type: String, default: "MedCase Partner Clinic" },
  city: { type: String, default: "Mumbai" },
  lat: { type: Number, default: 19.0760 }, 
  lng: { type: Number, default: 72.8777 },
  availability: {
      startTime: { type: String, default: "09:00" },
      endTime: { type: String, default: "17:00" },
      slotDuration: { type: Number, default: 15 } 
  }
});
const User = mongoose.model('Account', userSchema);

const patientSchema = new mongoose.Schema({
  consultationId: { type: String, unique: true, index: true },
  appointmentType: String,
  doctorName: String,
  doctorPhone: String,
  patientName: String,
  patientPhone: String,
  age: Number,
  symptoms: String,
  prescribedMedications: String,
  pastMedicalHistory: String,
  pastHistoryDocUrl: String,
  heartRate: String,
  bloodPressure: String,
  temperature: String,
  spo2: String,
  bloodSugar: String,
  weight: String, 
  height: String, 
  aiDiagnosis: String,
  documentsUrl: String, 
  date: { type: Date, default: Date.now }
}, { strict: false });
const Patient = mongoose.model('Patient', patientSchema);

const appointmentSchema = new mongoose.Schema({
  consultationId: { type: String, unique: true },
  appointmentType: { type: String, default: 'Offline' },
  doctorName: String,
  doctorPhone: String,
  patientName: String,
  patientPhone: String,
  age: Number,
  symptoms: String,
  pastMedicalHistory: String,
  pastHistoryDocUrl: String,
  heartRate: String,
  bloodPressure: String,
  temperature: String,
  spo2: String,
  bloodSugar: String,
  weight: String, 
  height: String, 
  specialization: String,
  date: String,
  timeSlot: String,
  status: { type: String, default: "Confirmed" },
  createdAt: { type: Date, default: Date.now }
});
const Appointment = mongoose.model('Appointment', appointmentSchema);

const messageSchema = new mongoose.Schema({
  consultationId: { type: String, index: true },
  senderPhone: String,
  receiverPhone: String,
  text: String,
  mediaUrl: String,
  isAudio: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function generate10DigitId() {
  return Math.floor(1000000000 + Math.random() * 9000000000).toString();
}

app.get('/api/geocode', async (req, res) => {
  const { lat, lng } = req.query;
  try {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Google Maps API Error:", error);
    res.status(500).json({ status: "ERROR", error: "Geocoding failed on server" });
  }
});

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
  const { name, phone, password, role, specialization, profilePicUrl, clinicName, city, lat, lng } = req.body;
  try {
      let existingUser = await User.findOne({ phone });
      if (existingUser) return res.json({ success: false, message: "Phone number already registered. Please log in." });
      const user = new User({ name, phone, password, role, specialization, profilePicUrl, clinicName, city, lat, lng });
      await user.save();
      res.json({ success: true, role: user.role, name: user.name, phone: user.phone, profilePicUrl: user.profilePicUrl, specialization: user.specialization, availability: user.availability, message: "Account created successfully!" });
  } catch (err) { res.status(500).json({ success: false, message: "Registration failed." }); }
});

app.post('/api/login', async (req, res) => {
  const { phone, password } = req.body;
  try {
      let user = await User.findOne({ phone });
      if (!user) return res.json({ success: false, message: "Account not found. Please register." });
      if (user.password !== password) return res.json({ success: false, message: "Incorrect password!" });
      res.json({ success: true, role: user.role, name: user.name, phone: user.phone, profilePicUrl: user.profilePicUrl, specialization: user.specialization, availability: user.availability, message: "Login successful!" });
  } catch (err) { res.status(500).json({ success: false, message: "Server error" }); }
});

app.post('/api/user/update', async (req, res) => {
    const { oldPhone, newPhone, profilePicUrl, role, availability } = req.body;
    try {
        if (oldPhone !== newPhone) {
            const exists = await User.findOne({ phone: newPhone });
            if (exists) return res.json({ success: false, message: "Phone already registered." });
        }
        const user = await User.findOne({ phone: oldPhone });
        if (!user) return res.json({ success: false, message: "User not found." });

        user.phone = newPhone;
        if (profilePicUrl) user.profilePicUrl = profilePicUrl;
        if (availability) user.availability = availability;
        
        await user.save();

        if (role === 'doctor') {
            await Patient.updateMany({ doctorPhone: oldPhone }, { doctorPhone: newPhone });
            await Appointment.updateMany({ doctorPhone: oldPhone }, { doctorPhone: newPhone });
        } else {
            await Patient.updateMany({ patientPhone: oldPhone }, { patientPhone: newPhone });
            await Appointment.updateMany({ patientPhone: oldPhone }, { patientPhone: newPhone });
        }
        
        res.json({ success: true, phone: user.phone, profilePicUrl: user.profilePicUrl, availability: user.availability, message: "Profile updated!" });
    } catch (err) { res.status(500).json({ success: false, message: "Update failed." }); }
});

// --- AI ROUTES ---
app.post('/api/transcribe', async (req, res) => {
  const { audioBase64 } = req.body;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
    const prompt = `You are an expert medical scribe. Listen to the following audio. Extract only the medical symptoms or medical history being described. Format the output as a clean, concise list or paragraph. ONLY return the relevant medical context in short phrases.`;
    const audioPart = { inlineData: { data: audioBase64, mimeType: "audio/webm" } };
    const result = await model.generateContent([prompt, audioPart]);
    res.json({ success: true, text: result.response.text() });
  } catch (error) {
    console.error("Gemini API Audio Error:", error);
    res.status(500).json({ success: false, error: error.message || "Audio processing failed." });
  }
});

app.post('/api/diagnose', async (req, res) => {
  const { age, symptoms, pastMedicalHistory, pastHistoryDocUrl, doctorNotes, doctorDocBase64, doctorDocMimeType, heartRate, bloodPressure, temperature, spo2, bloodSugar, weight, height } = req.body;
  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-3.6-flash",
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
      ]
    });
    
    let vitalsContext = "";
    if (heartRate) vitalsContext += `HR: ${heartRate} bpm. `;
    if (bloodPressure) vitalsContext += `BP: ${bloodPressure}. `;
    if (temperature) vitalsContext += `Temp: ${temperature}. `;
    if (spo2) vitalsContext += `SpO2: ${spo2}%. `;
    if (bloodSugar) vitalsContext += `Blood Sugar: ${bloodSugar} mg/dL. `;
    if (weight) vitalsContext += `Weight: ${weight} kg. `;
    if (height) vitalsContext += `Height: ${height} cm. `;
    
    let prompt = `You are a Senior Diagnostician processing a full clinical chart. Analyze all details carefully.
    Patient Age: ${age}
    Reported Symptoms: "${symptoms}"
    Vitals: ${vitalsContext}
    Patient's Past Medical History: "${pastMedicalHistory || 'None provided'}"
    Doctor's Prescribed Plan/Notes: "${doctorNotes || 'None yet'}"

    Format your response exactly as follows using Markdown:
    **Primary Suspected Diagnosis:** (State the most likely condition and clinical reasoning).
    **Differential Diagnoses:** (List 2-3 alternative possibilities).
    **Red Flags:** (Identify any urgent warning signs in vitals or symptoms. If none, write 'None apparent').
    **Recommended Next Steps:** (Specific labs, imaging, or exams needed).

    Keep the response concise, authoritative, and under 150 words. Do not recommend specific pharmaceutical dosages.`;
    
    const parts = [{ text: prompt }];

    if (pastHistoryDocUrl) {
      try {
        const fileResponse = await fetch(pastHistoryDocUrl);
        const arrayBuffer = await fileResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = fileResponse.headers.get('content-type') || 'image/jpeg';
        if(mimeType.startsWith('image/') || mimeType === 'application/pdf') {
          parts.push({ inlineData: { data: buffer.toString("base64"), mimeType: mimeType } });
        }
      } catch(e) { console.error("Failed to inject Patient's Cloudinary doc to Gemini AI"); }
    }

    if (doctorDocBase64 && doctorDocMimeType) {
        if(doctorDocMimeType.startsWith('image/') || doctorDocMimeType === 'application/pdf') {
            parts.push({ inlineData: { data: doctorDocBase64, mimeType: doctorDocMimeType } });
        }
    }

    const result = await model.generateContent(parts); 
    
    let aiDiagnosis = "";
    try { aiDiagnosis = result.response.text(); } 
    catch (textErr) {
      const candidate = result.response?.candidates?.[0];
      if (candidate?.content?.parts?.[0]?.text) { aiDiagnosis = candidate.content.parts[0].text; } 
      else { throw new Error("AI returned an empty candidate or was blocked by filters."); }
    }
    
    res.json({ success: true, aiDiagnosis });
  } catch (error) {
    console.error("Diagnosis Error Details:", error);
    res.status(500).json({ success: false, error: error.message || "Diagnostic generation failed" });
  }
});

// --- CLINICAL RECORDS ROUTES ---
app.post('/api/patients/save', async (req, res) => {
    try {
        const { consultationId } = req.body;
        const newRecord = new Patient(req.body);
        await newRecord.save();
        await Appointment.findOneAndUpdate({ consultationId }, { status: 'Completed' });
        res.json({ success: true, record: newRecord });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: "Failed to save final consultation record." });
    }
});

app.post('/api/patients/update', async (req, res) => {
    try {
        const { consultationId, ...updates } = req.body;
        const updatedRecord = await Patient.findOneAndUpdate({ consultationId }, updates, { new: true });
        res.json({ success: true, record: updatedRecord });
    } catch (err) { res.status(500).json({ success: false, error: "Failed to update record." }); }
});

app.get('/api/patients', async (req, res) => {
  try {
    const { doctorPhone, patientPhone } = req.query;
    let query = {};
    if (doctorPhone) query.doctorPhone = doctorPhone;
    if (patientPhone) query.patientPhone = patientPhone;
    const records = await Patient.find(query).sort({ date: -1 });
    res.json(records);
  } catch (error) { res.status(500).json({ error: "Failed to fetch records" }); }
});

app.get('/api/doctors', async (req, res) => {
  try {
    const { specialization, city, search } = req.query;
    let query = { role: 'doctor' };
    if (specialization && specialization !== 'All') query.specialization = specialization;
    if (city) query.city = { $regex: new RegExp(`^${city}$`, 'i') }; 
    if (search) query.$or = [{ clinicName: { $regex: search, $options: 'i' } }, { name: { $regex: search, $options: 'i' } }];
    const doctors = await User.find(query).select('-password');
    res.json(doctors);
  } catch (err) { res.status(500).json({ error: "Failed to fetch doctors list" }); }
});

// --- APPOINTMENT ROUTES ---
app.post('/api/appointments/book', async (req, res) => {
  const payload = req.body;
  try {
    const existing = await Appointment.findOne({ doctorPhone: payload.doctorPhone, date: payload.date, timeSlot: payload.timeSlot, status: "Confirmed" });
    if (existing) return res.json({ success: false, message: "This time slot is already taken. Please choose another." });

    payload.consultationId = generate10DigitId();
    const appointment = new Appointment(payload);
    await appointment.save();
    res.json({ success: true, appointment, message: "Appointment booked successfully!" });
  } catch (err) { res.status(500).json({ success: false, message: "Could not complete booking" }); }
});

app.get('/api/appointments', async (req, res) => {
  const { phone, role } = req.query;
  try {
    const filter = role === 'doctor' ? { doctorPhone: phone } : { patientPhone: phone };
    const appointments = await Appointment.find(filter).sort({ date: 1, timeSlot: 1 });
    res.json(appointments);
  } catch (err) { res.status(500).json({ error: "Failed to load appointments" }); }
});

app.post('/api/appointments/update-status', async (req, res) => {
  const { appointmentId, status } = req.body;
  try {
    const appointment = await Appointment.findByIdAndUpdate(appointmentId, { status }, { new: true });
    if (!appointment) return res.json({ success: false, message: "Appointment not found." });
    res.json({ success: true, appointment });
  } catch (err) { res.status(500).json({ success: false, error: "Failed to update appointment status" }); }
});

// --- CHAT ROUTES ---
app.post('/api/chat/send', async (req, res) => {
  try {
      const msg = new Message(req.body);
      await msg.save();
      res.json({ success: true, message: msg });
  } catch (err) { res.status(500).json({ success: false, error: "Failed to send message" }); }
});

app.get('/api/chat/:consultationId', async (req, res) => {
  try {
      const msgs = await Message.find({ consultationId: req.params.consultationId }).sort({ timestamp: 1 });
      res.json(msgs);
  } catch (err) { res.status(500).json({ error: "Failed to fetch chat history" }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));