window.downloadPDF = function() {
    const element = document.getElementById('printableReport');
    const editDocWrapper = document.getElementById('editDocumentWrapper');
    if (editDocWrapper) editDocWrapper.style.display = 'none';

    let patientName = "Patient";
    try { patientName = document.getElementById('modalPatientContact').innerText.split('\n')[1].split('(')[0].trim().replace(/[^a-zA-Z0-9]/g, "_"); } catch(e) {}
    
    html2pdf().set({ 
        margin: 0.5, 
        filename: `Report_${patientName}.pdf`, 
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { scale: 2, useCORS: true }, 
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' } 
    }).from(element).save().then(() => {
        if (editDocWrapper) editDocWrapper.style.display = '';
    });
}

let currentUserName = '', currentUserPhone = '', currentRole = '', currentProfilePicUrl = '', patientRecords = [];
let currentAvailability = { startTime: "09:00", endTime: "17:00", slotDuration: 15 };
let activeConsultationApt = null;
let trendsChartInstance = null; 

// --- NATIVE TIME SLOT GENERATOR ---
function generateTimeSlots(startStr, endStr, durationMins) {
    const slots = [];
    if (!startStr || !endStr || !durationMins) return slots;
    
    let [startH, startM] = startStr.split(':').map(Number);
    let [endH, endM] = endStr.split(':').map(Number);
    
    let current = new Date(); current.setHours(startH, startM, 0, 0);
    let end = new Date(); end.setHours(endH, endM, 0, 0);
    
    while (current < end) {
        let h = current.getHours(), m = current.getMinutes();
        let ampm = h >= 12 ? 'PM' : 'AM';
        let displayH = h % 12 || 12; let displayM = m < 10 ? '0'+m : m;
        slots.push(`${displayH < 10 ? '0'+displayH : displayH}:${displayM} ${ampm}`);
        current.setMinutes(current.getMinutes() + Number(durationMins));
    }
    return slots;
}

window.toggleAuth = mode => {
    document.getElementById('loginScreen').classList.toggle('hidden', mode === 'register');
    document.getElementById('registerScreen').classList.toggle('hidden', mode === 'login');
}
window.toggleDoctorFields = () => document.getElementById('doctorFields').classList.toggle('hidden', document.getElementById('regRole').value !== 'doctor');

window.logout = e => {
    if(e) e.stopPropagation(); 
    currentUserName = ''; currentUserPhone = ''; currentRole = ''; currentProfilePicUrl = ''; 
    currentAvailability = { startTime: "09:00", endTime: "17:00", slotDuration: 15 };
    document.getElementById('profileDropdown').classList.add('hidden');
    document.getElementById('authOverlay').style.display = 'flex'; document.getElementById('authOverlay').style.opacity = '1';
    ['loginPhone', 'loginPassword', 'manualTelehealthRoomId'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    if(trendsChartInstance) { trendsChartInstance.destroy(); trendsChartInstance = null; }
    window.toggleAuth('login');
}

window.toggleProfileMenu = e => { e.stopPropagation(); document.getElementById('profileDropdown').classList.toggle('hidden'); document.getElementById('profileDropdownIcon').classList.toggle('rotate-180'); }
window.onclick = () => { document.getElementById('profileDropdown').classList.add('hidden'); document.getElementById('profileDropdownIcon').classList.remove('rotate-180'); }

window.openEditProfileModal = e => { 
    e.stopPropagation(); document.getElementById('profileDropdown').classList.add('hidden'); 
    document.getElementById('editPhone').value = currentUserPhone; 
    
    const docSettings = document.getElementById('doctorSlotSettings');
    if (currentRole === 'doctor') {
        docSettings.classList.remove('hidden');
        document.getElementById('editStartTime').value = currentAvailability.startTime || "09:00";
        document.getElementById('editEndTime').value = currentAvailability.endTime || "17:00";
        document.getElementById('editSlotDuration').value = currentAvailability.slotDuration || 15;
    } else { docSettings.classList.add('hidden'); }
    
    document.getElementById('editProfileModal').classList.remove('hidden'); 
}
window.closeEditProfileModal = () => document.getElementById('editProfileModal').classList.add('hidden');

window.saveProfileEdits = async () => {
    const newPhone = document.getElementById('editPhone').value.trim();
    if (!newPhone) return alert("Phone number cannot be empty.");
    
    let availabilityPayload = null;
    if (currentRole === 'doctor') {
        availabilityPayload = {
            startTime: document.getElementById('editStartTime').value,
            endTime: document.getElementById('editEndTime').value,
            slotDuration: Number(document.getElementById('editSlotDuration').value)
        };
        if (!availabilityPayload.startTime || !availabilityPayload.endTime) return alert("Please select valid start and end times.");
    }

    document.getElementById('saveProfileBtn').disabled = true;
    try {
        let newPicUrl = currentProfilePicUrl;
        if (document.getElementById('editProfilePic').files.length > 0) newPicUrl = await uploadToCloudinary(document.getElementById('editProfilePic').files[0]);
        
        const res = await fetch('/api/user/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldPhone: currentUserPhone, newPhone, profilePicUrl: newPicUrl, role: currentRole, availability: availabilityPayload }) });
        const data = await res.json();
        if (data.success) {
            currentUserPhone = data.phone; currentProfilePicUrl = data.profilePicUrl; 
            if(data.availability) currentAvailability = data.availability;
            document.getElementById('dropdownPhone').innerHTML = `<i class="fas fa-phone mr-2 text-teal-600 text-xs"></i>${currentUserPhone}`;
            if(currentProfilePicUrl) document.getElementById('sidebarProfilePic').src = currentProfilePicUrl;
            window.loadHistory(); window.closeEditProfileModal();
        } else alert(data.message);
    } catch (err) { alert("Failed to update profile."); }
    document.getElementById('saveProfileBtn').disabled = false;
}

function setupSidebar(data) {
    const safeName = data.name || "User"; 
    currentUserName = safeName; currentUserPhone = data.phone; currentRole = data.role; currentProfilePicUrl = data.profilePicUrl;
    if(data.availability) currentAvailability = data.availability;

    document.getElementById('authOverlay').style.opacity = '0'; setTimeout(() => document.getElementById('authOverlay').style.display = 'none', 300);
    
    if (document.getElementById('sidebarName')) document.getElementById('sidebarName').innerText = currentRole === 'doctor' ? `Dr. ${safeName}` : safeName;
    if (document.getElementById('sidebarRole')) document.getElementById('sidebarRole').innerText = currentRole === 'doctor' ? (data.specialization || 'Doctor') : "Patient";
    if (document.getElementById('dropdownPhone')) document.getElementById('dropdownPhone').innerHTML = `<i class="fas fa-phone mr-2 text-teal-600 text-xs"></i>${data.phone}`;
    if (document.getElementById('sidebarProfilePic')) document.getElementById('sidebarProfilePic').src = data.profilePicUrl || `https://ui-avatars.com/api/?name=${safeName.replace(/\s+/g, '+')}&background=0D8B93&color=fff`;

    document.getElementById('tab-doctors').style.display = currentRole === 'doctor' ? 'none' : 'flex';
    document.getElementById('tab-appointments').style.display = currentRole === 'patient' ? 'none' : 'flex';
    document.getElementById('tab-history-text').innerText = currentRole === 'patient' ? 'Past Consultations' : 'Patient Archive';
    document.getElementById('history-view-title').innerText = currentRole === 'patient' ? 'Past Consultations' : 'Patient Archive';

    window.switchTab(currentRole === 'patient' ? 'doctors' : 'appointments');
}

let regLat = null, regLng = null;
window.getRegistrationLocation = (e) => {
    e.preventDefault();
    const status = document.getElementById('regLocationStatus'), cityInput = document.getElementById('regCity');
    status.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Locating...";
    navigator.geolocation.getCurrentPosition(
        async pos => { 
            regLat = pos.coords.latitude; regLng = pos.coords.longitude; 
            status.innerHTML = "<i class='fas fa-spinner fa-spin'></i> Verifying with Google Maps...";
            try {
                const res = await fetch(`/api/geocode?lat=${regLat}&lng=${regLng}`);
                const data = await res.json();
                if (data.status === "OK" && data.results.length > 0) {
                    const components = data.results[0].address_components;
                    const cityObj = components.find(c => c.types.includes("locality")) || components.find(c => c.types.includes("administrative_area_level_2"));
                    if (cityObj) {
                        cityInput.value = cityObj.long_name; cityInput.readOnly = true; cityInput.classList.add('bg-teal-50', 'text-teal-800', 'font-bold');
                        status.innerHTML = "<span class='text-teal-600 font-bold'><i class='fas fa-check-circle'></i> Verified by Google</span>";
                    } else { status.innerHTML = "<span class='text-teal-600 font-bold'>GPS pinned (Type city manually)</span>"; }
                } else { status.innerHTML = "<span class='text-red-500 font-bold'>Google API Error. Type manually.</span>"; }
            } catch (err) { status.innerHTML = "<span class='text-teal-600 font-bold'>GPS pinned (Type city manually)</span>"; }
        },
        err => { status.innerText = "Location denied. Please type manually."; }
    );
}

window.register = async () => {
    const toTitleCase = (str) => str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
    const name = toTitleCase(document.getElementById('regName').value.trim()), phone = document.getElementById('regPhone').value.trim(), password = document.getElementById('regPassword').value.trim(), role = document.getElementById('regRole').value;
    const specialization = role === 'doctor' ? document.getElementById('regSpecialization').value : '';
    let clinicName = role === 'doctor' ? document.getElementById('regClinicName').value.trim() : '';
    let city = role === 'doctor' ? document.getElementById('regCity').value.trim() : '';
    if (clinicName) clinicName = toTitleCase(clinicName);
    if (city) city = toTitleCase(city);
    const picInput = document.getElementById('regProfilePic');
    
    if (!name || !phone || !password) return alert('Please fill in Name, Phone, and Password.');
    document.getElementById('registerBtn').disabled = true;
    try {
        const profilePicUrl = (role === 'doctor' && picInput.files.length > 0) ? await uploadToCloudinary(picInput.files[0]) : "";
        const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone, password, role, specialization, profilePicUrl, clinicName, city, lat: regLat, lng: regLng }) });
        const data = await res.json();
        data.success ? setupSidebar(data) : alert(data.message); 
    } catch (err) { alert("Registration failed."); }
    document.getElementById('registerBtn').disabled = false;
}

window.login = async () => {
    const phone = document.getElementById('loginPhone').value.trim(), password = document.getElementById('loginPassword').value.trim();
    if (!phone || !password) return alert('Enter Phone Number and Password.');
    try {
        const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password }) });
        const data = await res.json();
        if (data.success) { setupSidebar(data); } else { alert(data.message); }
    } catch (err) { alert("Login crashed! Press F12 and check the Console tab for details."); }
}

window.switchTab = tabName => {
    ['appointments', 'history', 'telehealth', 'doctors', 'consultation'].forEach(t => {
        const view = document.getElementById(`view-${t}`), tab = document.getElementById(`tab-${t}`);
        if(view) view.classList.add('hidden');
        if(tab) {
            tab.classList.remove('bg-teal-50', 'text-teal-800', 'border-teal-600', 'font-bold', 'shadow-sm');
            tab.classList.add('text-slate-600', 'border-transparent', 'font-medium');
        }
    });

    const activeView = document.getElementById(`view-${tabName}`), activeTab = document.getElementById(`tab-${tabName}`);
    if(activeView) activeView.classList.remove('hidden');
    if(activeTab) {
        activeTab.classList.remove('text-slate-600', 'border-transparent', 'font-medium');
        activeTab.classList.add('bg-teal-50', 'text-teal-800', 'border-teal-600', 'font-bold', 'shadow-sm');
    }

    if(tabName === 'history') window.loadHistory();
    if(tabName === 'doctors') window.loadDoctors();
    if(tabName === 'appointments' || tabName === 'telehealth' || tabName === 'doctors') window.loadAppointments();
}

async function uploadToCloudinary(file) {
    const cloudName = 's6sfkqkf';  // ⚠️ RE-PASTE YOUR CREDENTIALS HERE
    const uploadPreset = 'axwiy5ih'; // ⚠️ RE-PASTE YOUR CREDENTIALS HERE
    const fd = new FormData(); fd.append('file', file); fd.append('upload_preset', uploadPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, { method: 'POST', body: fd });
    return (await res.json()).secure_url; 
}
const fileToBase64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.readAsDataURL(file); reader.onload = () => resolve(reader.result); reader.onerror = reject; });

let mediaRecorder, audioChunks = [], isRecording = false;
window.toggleRecording = async (btnId, boxId) => {
    const micBtn = document.getElementById(btnId), symBox = document.getElementById(boxId);
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream); audioChunks = [];
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop());
                micBtn.innerHTML = '<i class="fas fa-spinner fa-spin text-[10px]"></i>'; 
                try {
                    const base64Audio = (await fileToBase64(new Blob(audioChunks, { type: 'audio/webm' }))).split(',')[1];
                    const res = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audioBase64: base64Audio }) });
                    const data = await res.json();
                    if(data.success) { symBox.value = symBox.value ? `${symBox.value}\n\n${data.text}` : data.text; } else { alert(`Google API Error:\n${data.error}`); }
                } catch (e) { alert("Server fetch failed entirely."); }
                micBtn.innerHTML = '<i class="fas fa-microphone text-[10px]"></i>'; 
            };
            mediaRecorder.start(); isRecording = true;
            micBtn.innerHTML = '<i class="fas fa-stop text-[10px]"></i>'; micBtn.classList.replace('bg-slate-100', 'bg-red-600'); micBtn.classList.replace('text-slate-600', 'text-white'); micBtn.classList.add('animate-pulse');
        } catch (err) { alert("Microphone access denied."); }
    } else {
        mediaRecorder.stop(); isRecording = false;
        micBtn.classList.remove('animate-pulse'); micBtn.classList.replace('bg-red-600', 'bg-slate-100'); micBtn.classList.replace('text-white', 'text-slate-600');
    }
};

let userCoords = null; 
let selectedDoctorForBooking = null;

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; const dLat = (lat2 - lat1) * (Math.PI / 180); const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return (R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(1); 
}

window.getUserLocation = function() {
    const status = document.getElementById('userLocationStatus');
    if (!navigator.geolocation) { status.innerText = "Geolocation not supported."; return; }
    status.innerText = "Locating your position...";
    navigator.geolocation.getCurrentPosition(
        pos => { userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; status.innerText = `Location verified (${(pos.coords.accuracy / 1000).toFixed(1)} km precision).`; window.loadDoctors(); },
        err => { status.innerText = "Location permission denied. Showing default distances."; window.loadDoctors(); }
    );
};

window.loadDoctors = async function() {
    const filter = document.getElementById('docSpecializationFilter')?.value || 'All';
    try {
        const res = await fetch(`/api/doctors?specialization=${filter}`);
        let doctors = await res.json();
        if (userCoords) { doctors = doctors.map(doc => { return { ...doc, distanceKm: calculateDistanceKm(userCoords.lat, userCoords.lng, doc.lat, doc.lng) ? parseFloat(calculateDistanceKm(userCoords.lat, userCoords.lng, doc.lat, doc.lng)) : 9999 }; }); doctors.sort((a, b) => a.distanceKm - b.distanceKm); }
        const grid = document.getElementById('doctorsListGrid');
        if (doctors.length === 0) { grid.innerHTML = `<div class="col-span-3 text-center p-8 bg-white rounded-xl border border-slate-200 text-slate-400 text-sm">No doctors found matching this specialty.</div>`; return; }

        grid.innerHTML = doctors.map(doc => `
            <div class="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
                <div>
                    <div class="flex items-center space-x-3 mb-3"><img src="${doc.profilePicUrl || `https://ui-avatars.com/api/?name=${doc.name.replace(/\s+/g, '+')}&background=0D8B93&color=fff`}" class="w-12 h-12 rounded-full border border-teal-100 object-cover" /><div><h4 class="font-bold text-slate-800 text-sm">Dr. ${doc.name}</h4><span class="text-xs font-semibold text-teal-600">${doc.specialization}</span></div></div>
                    <div class="space-y-1.5 text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100 mb-4"><p><i class="fas fa-hospital mr-2 text-slate-400"></i>${doc.clinicName || 'MedCase Clinic'}</p><p><i class="fas fa-city mr-2 text-slate-400"></i>${doc.city || 'Regional Center'}</p><p class="font-bold text-teal-800"><i class="fas fa-route mr-2 text-teal-600"></i>${doc.distanceKm !== undefined && doc.distanceKm !== 9999 ? `${doc.distanceKm} km away` : 'Proximity pending GPS'}</p></div>
                </div>
                <button onclick='window.openBookingModal(${JSON.stringify(doc).replace(/'/g, "&#39;")})' class="w-full bg-teal-700 hover:bg-teal-800 text-white font-bold py-2 rounded-lg text-xs shadow-sm flex justify-center items-center"><i class="fas fa-calendar-plus mr-1.5"></i> Book Appointment</button>
            </div>`).join('');
    } catch (err) { console.error("Doctor load failure", err); }
};

window.openBookingModal = function(doctorObj) {
    selectedDoctorForBooking = { name: doctorObj.name, phone: doctorObj.phone, spec: doctorObj.specialization };
    document.getElementById('bookingDoctorTitle').innerText = `Dr. ${doctorObj.name} (${doctorObj.specialization})`;
    
    const slotSelect = document.getElementById('bookTimeSlot');
    let slots = [];
    if (doctorObj.availability) {
        slots = generateTimeSlots(doctorObj.availability.startTime, doctorObj.availability.endTime, doctorObj.availability.slotDuration);
    } else {
        slots = generateTimeSlots("09:00", "17:00", 15);
    }
    
    if (slots.length > 0) { slotSelect.innerHTML = slots.map(s => `<option value="${s}">${s}</option>`).join(''); } 
    else { slotSelect.innerHTML = `<option value="">No valid slots configured</option>`; }

    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('bookDate').value = tomorrow.toISOString().split('T')[0];
    
    ['bookAge', 'bookHeight', 'bookWeight', 'bookHR', 'bookBP', 'bookTemp', 'bookSpO2', 'bookSugar', 'bookSymptoms', 'bookPastHistory', 'bookPastHistoryUpload'].forEach(id => document.getElementById(id).value = '');
    
    document.getElementById('bookingModal').classList.remove('hidden');
};

window.closeBookingModal = function() { selectedDoctorForBooking = null; document.getElementById('bookingModal').classList.add('hidden'); };

window.confirmBooking = async function() {
    const date = document.getElementById('bookDate').value, timeSlot = document.getElementById('bookTimeSlot').value;
    const type = document.getElementById('bookType').value;
    
    const age = document.getElementById('bookAge').value, height = document.getElementById('bookHeight').value, weight = document.getElementById('bookWeight').value;
    const symptoms = document.getElementById('bookSymptoms').value.trim();
    
    if (!date || !timeSlot || !symptoms || !age || !height || !weight) return alert("Please complete Date, valid Time Slot, Age, Height, Weight, and Symptoms.");
    
    const btn = document.getElementById('confirmBookingBtn'); btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Uploading & Reserving...';
    try {
        let docUrl = ""; const fileInput = document.getElementById('bookPastHistoryUpload');
        if (fileInput.files.length > 0) docUrl = await uploadToCloudinary(fileInput.files[0]);

        const payload = { 
            doctorName: selectedDoctorForBooking.name, doctorPhone: selectedDoctorForBooking.phone, 
            patientName: currentUserName, patientPhone: currentUserPhone, specialization: selectedDoctorForBooking.spec, 
            date, timeSlot, appointmentType: type, age, symptoms, 
            heartRate: document.getElementById('bookHR').value, bloodPressure: document.getElementById('bookBP').value,
            temperature: document.getElementById('bookTemp').value, spo2: document.getElementById('bookSpO2').value,
            bloodSugar: document.getElementById('bookSugar').value, weight, height,
            pastMedicalHistory: document.getElementById('bookPastHistory').value.trim(), pastHistoryDocUrl: docUrl 
        };
        const res = await fetch('/api/appointments/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) { alert(`Appointment Reserved! Consultation ID: ${data.appointment.consultationId}`); window.closeBookingModal(); window.switchTab(currentRole === 'patient' ? 'doctors' : 'appointments'); } else { alert(data.message); }
    } catch (err) { alert("Booking request failed."); }
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-check mr-2"></i> Book & Generate Secure ID';
};

function renderTrendsChart(appointments) {
    const ctx = document.getElementById('trendsChart');
    if (!ctx) return;
    
    if (trendsChartInstance) { trendsChartInstance.destroy(); }

    let countOnline = 0; let countOffline = 0;
    appointments.forEach(apt => { if(apt.appointmentType === 'Online') countOnline++; else countOffline++; });

    trendsChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Online Consults', 'In-Clinic Visits'],
            datasets: [{
                data: [countOnline, countOffline],
                backgroundColor: ['#0d9488', '#f59e0b'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '70%' }
    });
}

window.loadAppointments = async function() {
    try {
        const res = await fetch(`/api/appointments?phone=${currentUserPhone}&role=${currentRole}`);
        let allAppointments = await res.json();
        const appointments = allAppointments.filter(apt => apt.status !== 'Completed');

        const renderCard = (apt) => {
            const targetName = currentRole === 'doctor' ? apt.patientName : `Dr. ${apt.doctorName}`;
            const targetPhone = currentRole === 'doctor' ? apt.patientPhone : apt.doctorPhone;
            return `
            <div class="p-5 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col hover:shadow-md transition-all">
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <span class="text-[10px] font-bold font-mono bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded mr-2 inline-block">${apt.consultationId}</span>
                        <span class="text-[10px] font-bold ${apt.appointmentType === 'Online' ? 'bg-teal-50 text-teal-700 border border-teal-200' : 'bg-amber-50 text-amber-700 border border-amber-200'} px-2 py-0.5 rounded uppercase">${apt.appointmentType}</span>
                        <p class="text-sm font-bold text-slate-800 mt-2">${targetName}</p>
                        <p class="text-xs text-slate-500 mt-0.5"><i class="fas fa-clock mr-1 text-teal-600"></i>${apt.date} at ${apt.timeSlot}</p>
                    </div>
                    <span class="text-[10px] font-bold px-2.5 py-1 rounded bg-teal-100 text-teal-800 border border-teal-200">${apt.status}</span>
                </div>
                <div class="flex flex-wrap gap-2 mt-auto pt-3 border-t border-slate-100">
                    <button onclick="window.openPersistentChat('${apt.consultationId}', '${targetPhone}', '${targetName.replace(/'/g, "\\'")}')" class="text-[10px] bg-white text-teal-700 hover:bg-teal-50 border border-teal-600 px-3 py-1.5 rounded shadow-sm transition-colors flex items-center font-bold"><i class="fas fa-comment-medical mr-1.5"></i> Chat</button>
                    ${apt.appointmentType === 'Online' && currentRole === 'patient' ? `<button onclick="window.joinManualTelehealthFromList('${apt.consultationId}')" class="text-[10px] bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 rounded shadow-sm transition-colors flex items-center font-bold"><i class="fas fa-video mr-1.5"></i> Join Video</button>` : ''}
                    ${currentRole === 'doctor' ? `<button onclick='window.startConsultation(${JSON.stringify(apt).replace(/'/g, "&#39;")})' class="text-[10px] bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 rounded shadow-sm transition-colors flex items-center font-bold ml-auto"><i class="fas fa-stethoscope mr-1.5"></i> Start Consult</button>` : ''}
                </div>
            </div>`;
        };

        if (currentRole === 'doctor') {
            const container = document.getElementById('myAppointmentsList');
            if(container) {
                if (appointments.length === 0) { container.innerHTML = `<div class="col-span-2 text-center p-6 bg-slate-50 border border-slate-200 text-slate-400 text-sm rounded-lg">No pending appointments found. Completed sessions are stored in your Archive.</div>`; } else { container.innerHTML = appointments.map(renderCard).join(''); }
            }
            
            const statTotal = document.getElementById('statTotal'), statOn = document.getElementById('statOnline'), statOff = document.getElementById('statOffline');
            if(statTotal) {
                let online = 0, offline = 0;
                appointments.forEach(a => { if(a.appointmentType==='Online') online++; else offline++; });
                statTotal.innerText = appointments.length; statOn.innerText = online; statOff.innerText = offline;
                renderTrendsChart(appointments);
            }

        } else {
            const patContainer = document.getElementById('patientAppointmentsList');
            const section = document.getElementById('patientUpcomingSection');
            if(section && patContainer) {
                if (appointments.length === 0) { section.classList.add('hidden'); } else { section.classList.remove('hidden'); patContainer.innerHTML = appointments.map(renderCard).join(''); }
            }
        }

        const thContainer = document.getElementById('telehealthConsultationList');
        if (thContainer) {
            const onlineApts = appointments.filter(a => a.appointmentType === 'Online');
            if (onlineApts.length === 0) {
                thContainer.innerHTML = `<div class="text-center p-4 bg-slate-50 border border-slate-200 text-slate-400 text-xs rounded-lg">No pending online consultations available.</div>`;
            } else {
                thContainer.innerHTML = onlineApts.map(apt => {
                    const targetName = currentRole === 'doctor' ? apt.patientName : `Dr. ${apt.doctorName}`;
                    const targetPhone = currentRole === 'doctor' ? apt.patientPhone : apt.doctorPhone;
                    return `<div class="flex items-center justify-between p-4 bg-white hover:bg-teal-50/50 rounded-lg border border-slate-200 shadow-sm transition-colors"><div><span class="font-mono font-bold text-xs text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 mr-2">${apt.consultationId}</span><span class="text-sm font-bold text-slate-700">${targetName}</span><p class="text-xs text-slate-500 mt-1"><i class="fas fa-clock mr-1 text-teal-600"></i>${apt.date} at ${apt.timeSlot}</p></div><div class="flex space-x-2"><button onclick="window.openPersistentChat('${apt.consultationId}', '${targetPhone}', '${targetName.replace(/'/g, "\\'")}')" class="bg-white text-teal-700 hover:bg-teal-50 border border-teal-600 px-4 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center transition-colors"><i class="fas fa-comment-medical mr-1.5"></i> Chat</button><button onclick="window.joinManualTelehealthFromList('${apt.consultationId}')" class="bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center transition-colors"><i class="fas fa-video mr-1.5"></i> Join Video</button></div></div>`;
                }).join('');
            }
        }
    } catch (err) { console.error("Appointments load failure:", err); }
};

window.joinManualTelehealthFromList = (consultationId) => {
    document.getElementById('manualTelehealthRoomId').value = consultationId;
    window.switchTab('telehealth');
    window.joinManualTelehealth();
};

window.startConsultation = (apt) => {
    activeConsultationApt = apt;
    document.getElementById('consultPatientName').innerText = apt.patientName;
    document.getElementById('consultPatientAge').innerText = apt.age;
    document.getElementById('consultPatientPhone').innerText = apt.patientPhone;
    document.getElementById('consultIdLabel').innerText = apt.consultationId;
    
    document.getElementById('consultSymptoms').innerText = apt.symptoms || 'No symptoms provided.';
    const historyBox = document.getElementById('consultPastHistoryText');
    if (apt.pastMedicalHistory) { historyBox.innerText = apt.pastMedicalHistory; historyBox.classList.remove('hidden', 'italic', 'text-slate-400'); } else { historyBox.innerText = "No prior history reported."; historyBox.classList.add('italic', 'text-slate-400'); }
    
    const typeBadge = document.getElementById('consultAptTypeBadge');
    typeBadge.innerText = apt.appointmentType;
    typeBadge.className = `text-xs font-bold px-3 py-1.5 rounded uppercase tracking-wider ${apt.appointmentType === 'Online' ? 'bg-teal-100 text-teal-800 border border-teal-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}`;

    const pastBtn = document.getElementById('consultPastHistoryBtn');
    if (apt.pastHistoryDocUrl) { pastBtn.href = apt.pastHistoryDocUrl; pastBtn.classList.remove('hidden'); } else { pastBtn.classList.add('hidden'); pastBtn.href = '#'; }

    document.getElementById('vitalHR').value = apt.heartRate || '';
    document.getElementById('vitalBP').value = apt.bloodPressure || '';
    document.getElementById('vitalTemp').value = apt.temperature || '';
    document.getElementById('vitalSpO2').value = apt.spo2 || '';
    document.getElementById('vitalSugar').value = apt.bloodSugar || '';
    document.getElementById('vitalWeight').value = apt.weight || '';
    document.getElementById('vitalHeight').value = apt.height || '';
    document.getElementById('consultMedications').value = '';
    document.getElementById('aiOutput').value = '';
    document.getElementById('consultDocumentUpload').value = '';

    const videoWrapper = document.getElementById('videoWrapper'), consultVidCol = document.getElementById('consultVideoCol'), consultFormCol = document.getElementById('consultFormCol');
    if (apt.appointmentType === 'Online') {
        consultVidCol.appendChild(videoWrapper); videoWrapper.classList.remove('hidden'); consultVidCol.classList.remove('hidden'); consultFormCol.className = 'lg:col-span-7 space-y-6';
        window.switchTab('consultation'); window.launchVideoCall(apt.consultationId);
    } else {
        consultVidCol.classList.add('hidden'); videoWrapper.classList.add('hidden'); consultFormCol.className = 'lg:col-span-12 space-y-6';
        window.switchTab('consultation');
    }
};

window.generateDiagnosis = async () => {
    if (!activeConsultationApt) return;
    const btn = document.getElementById('analyzeBtn'); btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i> Analyzing...'; btn.disabled = true;
    
    let docB64 = null, docMime = null;
    const docInput = document.getElementById('consultDocumentUpload');
    if (docInput && docInput.files.length > 0) {
        const file = docInput.files[0]; docMime = file.type;
        const b64Full = await fileToBase64(file); docB64 = b64Full.split(',')[1];
    }

    const payload = {
        age: activeConsultationApt.age, symptoms: document.getElementById('consultSymptoms').innerText, 
        pastMedicalHistory: document.getElementById('consultPastHistoryText').innerText, pastHistoryDocUrl: activeConsultationApt.pastHistoryDocUrl,
        doctorNotes: document.getElementById('consultMedications').value.trim(), doctorDocBase64: docB64, doctorDocMimeType: docMime,
        heartRate: document.getElementById('vitalHR').value, bloodPressure: document.getElementById('vitalBP').value, temperature: document.getElementById('vitalTemp').value, 
        spo2: document.getElementById('vitalSpO2').value, bloodSugar: document.getElementById('vitalSugar').value, weight: document.getElementById('vitalWeight').value, height: document.getElementById('vitalHeight').value
    };
    
    try {
        const res = await fetch('/api/diagnose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) { document.getElementById('aiOutput').value = data.aiDiagnosis; } else { alert(`AI Error:\n${data.error}`); }
    } catch (err) { alert("Failed to fetch AI assessment."); }
    btn.innerHTML = '<i class="fas fa-magic mr-1.5"></i> Ask AI Assistant'; btn.disabled = false;
};

window.saveConsultation = async () => {
    if (!activeConsultationApt) return;
    const btn = document.getElementById('saveConsultBtn'); btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...'; btn.disabled = true;
    
    let docUrl = ""; const fileInput = document.getElementById('consultDocumentUpload');
    if (fileInput && fileInput.files.length > 0) { docUrl = await uploadToCloudinary(fileInput.files[0]); }

    const payload = {
        consultationId: activeConsultationApt.consultationId, appointmentType: activeConsultationApt.appointmentType,
        doctorName: activeConsultationApt.doctorName, doctorPhone: activeConsultationApt.doctorPhone, patientName: activeConsultationApt.patientName, patientPhone: activeConsultationApt.patientPhone, 
        age: activeConsultationApt.age, symptoms: document.getElementById('consultSymptoms').innerText, pastMedicalHistory: document.getElementById('consultPastHistoryText').innerText, pastHistoryDocUrl: activeConsultationApt.pastHistoryDocUrl,
        prescribedMedications: document.getElementById('consultMedications').value.trim(), aiDiagnosis: document.getElementById('aiOutput').value.trim(),
        heartRate: document.getElementById('vitalHR').value, bloodPressure: document.getElementById('vitalBP').value, temperature: document.getElementById('vitalTemp').value,
        spo2: document.getElementById('vitalSpO2').value, bloodSugar: document.getElementById('vitalSugar').value, weight: document.getElementById('vitalWeight').value, height: document.getElementById('vitalHeight').value,
        documentsUrl: docUrl
    };
    
    try {
        const res = await fetch('/api/patients/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.success) { 
            alert("Consultation Saved & Completed!"); 
            if(activeConsultationApt.appointmentType === 'Online') window.endTelehealth(); 
            activeConsultationApt = null; window.switchTab('appointments'); 
        } else { alert("Failed to save record."); }
    } catch (err) { alert("Network error saving consultation."); }
    btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i> Save & Complete Consult'; btn.disabled = false;
};

// --- ARCHIVE HISTORY & EDITING ---
let activeArchiveEditId = null;

window.loadHistory = async () => {
    const res = await fetch(`/api/patients?${currentRole === 'doctor' ? `doctorPhone=${currentUserPhone}` : `patientPhone=${currentUserPhone}`}`);
    patientRecords = await res.json(); 
    document.getElementById('historyTable').innerHTML = patientRecords.map((r, i) => {
        const targetName = currentRole === 'doctor' ? r.patientName : `Dr. ${r.doctorName}`;
        const targetPhone = currentRole === 'doctor' ? r.patientPhone : r.doctorPhone;
        return `
        <tr class="hover:bg-slate-50 border-b border-slate-200 group transition-colors">
            <td class="p-4 text-slate-700 text-xs"><span class="font-mono font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200 block w-fit mb-1">${r.consultationId}</span><span class="text-[10px] font-bold ${r.appointmentType === 'Online' ? 'text-teal-600' : 'text-amber-600'} uppercase block mb-1">${r.appointmentType || 'Offline'}</span><span class="text-slate-400">${new Date(r.date).toLocaleDateString()}</span></td>
            <td class="p-4 leading-relaxed"><span class="font-bold text-slate-800 block">${targetName}</span><span class="text-xs text-slate-500"><i class="fas fa-phone mr-1"></i>${targetPhone}</span></td>
            <td class="p-4 text-slate-600 text-sm cursor-pointer truncate max-w-xs" onclick="window.viewPatient(${i})">${r.symptoms}</td>
            <td class="p-4 text-right flex justify-end space-x-2">
                <button onclick="window.openPersistentChat('${r.consultationId}', '${targetPhone}', '${targetName.replace(/'/g, "\\'")}')" class="bg-white text-teal-700 border border-teal-600 px-3 py-1.5 rounded hover:bg-teal-50 text-xs font-bold shadow-sm flex items-center"><i class="fas fa-comment-medical mr-1.5"></i> Chat</button>
                <button onclick="window.viewPatient(${i})" class="bg-white text-slate-700 border border-slate-300 px-3 py-1.5 rounded hover:bg-slate-50 text-xs font-bold shadow-sm flex items-center"><i class="fas fa-folder-open mr-1.5"></i> Open File</button>
            </td>
        </tr>`;
    }).join('');

    const thHistoryList = document.getElementById('telehealthHistoryList'), thHistoryBox = document.getElementById('thHistoryBox');
    if (thHistoryList && thHistoryBox) {
        thHistoryBox.classList.remove('hidden');
        if (patientRecords.length === 0) { thHistoryList.innerHTML = `<div class="text-center p-4 bg-slate-50 border border-slate-200 text-slate-400 text-xs rounded-lg">No past cases available for reconnection.</div>`; } else {
            thHistoryList.innerHTML = patientRecords.map(r => {
                const targetName = currentRole === 'doctor' ? r.patientName : `Dr. ${r.doctorName}`;
                const targetPhone = currentRole === 'doctor' ? r.patientPhone : r.doctorPhone;
                return `<div class="flex items-center justify-between p-4 bg-white hover:bg-teal-50/50 rounded-lg border border-slate-200 shadow-sm transition-colors"><div><span class="font-mono font-bold text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 mr-2">${r.consultationId}</span><span class="text-sm font-bold text-slate-700">${targetName}</span><p class="text-xs text-slate-500 mt-1"><i class="fas fa-calendar-check mr-1 text-teal-600"></i>Completed on ${new Date(r.date).toLocaleDateString()}</p></div><div class="flex space-x-2"><button onclick="window.openPersistentChat('${r.consultationId}', '${targetPhone}', '${targetName.replace(/'/g, "\\'")}')" class="bg-white text-teal-700 hover:bg-teal-50 border border-teal-600 px-4 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center transition-colors"><i class="fas fa-comment-medical mr-1.5"></i> Chat</button><button onclick="window.joinManualTelehealthFromList('${r.consultationId}')" class="bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center transition-colors"><i class="fas fa-video mr-1.5"></i> Call</button></div></div>`;
            }).join('');
        }
    }
}

window.viewPatient = i => {
    const p = patientRecords[i], isDoc = currentRole === 'doctor'; activeArchiveEditId = p.consultationId;
    document.getElementById('modalConsultIdBadge').innerText = p.consultationId;
    document.getElementById('modalDoctorContact').innerHTML = `<span class="text-xs font-bold text-slate-500 uppercase block mb-1">Physician</span><span class="font-bold text-slate-800">Dr. ${p.doctorName}</span><br><span class="text-xs text-slate-600">${p.doctorPhone}</span>`;
    document.getElementById('modalPatientContact').innerHTML = `<span class="text-xs font-bold text-slate-500 uppercase block mb-1">Patient</span><span class="font-bold text-slate-800">${p.patientName} (${p.age})</span><br><span class="text-xs text-slate-600">${p.patientPhone}</span>`;
    
    const vClass = isDoc ? "w-full text-sm font-bold text-slate-800 p-1 border border-slate-300 rounded focus:border-teal-500 outline-none" : "text-sm font-bold text-slate-800 bg-transparent border-none outline-none";
    document.getElementById('modalVitals').innerHTML = `
        <div class="grid grid-cols-4 sm:grid-cols-7 gap-3 bg-slate-50 p-4 rounded border border-slate-200">
            <div><span class="block text-[10px] font-bold text-slate-500 uppercase mb-1">HR</span><input id="editHR" value="${p.heartRate || ''}" ${isDoc ? '' : 'readonly'} class="${vClass}"></div>
            <div><span class="block text-[10px] font-bold text-slate-500 uppercase mb-1">BP</span><input id="editBP" value="${p.bloodPressure || ''}" ${isDoc ? '' : 'readonly'} class="${vClass}"></div>
            <div><span class="block text-[10px] font-bold text-slate-500 uppercase mb-1">SpO2</span><input id="editSpO2" value="${p.spo2 || ''}" ${isDoc ? '' : 'readonly'} class="${vClass}"></div>
            <div><span class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Temp</span><input id="editTemp" value="${p.temperature || ''}" ${isDoc ? '' : 'readonly'} class="${vClass}"></div>
            <div><span class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Sugar</span><input id="editSugar" value="${p.bloodSugar || ''}" ${isDoc ? '' : 'readonly'} class="${vClass}"></div>
            <div><span class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Weight</span><input id="editWeight" value="${p.weight || ''}" ${isDoc ? '' : 'readonly'} class="${vClass}"></div>
            <div><span class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Height</span><input id="editHeight" value="${p.height || ''}" ${isDoc ? '' : 'readonly'} class="${vClass}"></div>
        </div>`;

    const sym = document.getElementById('modalSymptoms'), med = document.getElementById('modalMedications'), dia = document.getElementById('modalDiagnosis');
    
    sym.innerText = p.symptoms || ''; med.innerText = p.prescribedMedications || ''; dia.innerText = p.aiDiagnosis || '';
    
    if(isDoc) { 
        sym.contentEditable = "true"; med.contentEditable = "true"; dia.contentEditable = "true"; 
        document.getElementById('modalSaveEditsBtn').classList.remove('hidden'); 
        document.getElementById('editDocumentWrapper').classList.remove('hidden');
        [sym, med, dia].forEach(e => e.classList.replace('bg-slate-50', 'bg-white')); 
    } else { 
        sym.contentEditable = "false"; med.contentEditable = "false"; dia.contentEditable = "false"; 
        document.getElementById('modalSaveEditsBtn').classList.add('hidden'); 
        document.getElementById('editDocumentWrapper').classList.add('hidden');
        [sym, med, dia].forEach(e => e.classList.replace('bg-white', 'bg-slate-50')); 
    }
    
    let l = ''; if (p.documentsUrl) l += `<a href="${p.documentsUrl}" target="_blank" class="inline-flex text-sm font-bold text-teal-700 bg-white border border-slate-300 px-4 py-2 rounded shadow-sm hover:bg-slate-50 mr-2"><i class="fas fa-file-medical mr-2"></i> Final Report / Scan</a>`;
    if (p.pastHistoryDocUrl) l += `<a href="${p.pastHistoryDocUrl}" target="_blank" class="inline-flex text-sm font-bold text-teal-700 bg-white border border-slate-300 px-4 py-2 rounded shadow-sm hover:bg-slate-50"><i class="fas fa-history mr-2"></i> Past Record</a>`;
    document.getElementById('modalDocuments').innerHTML = l || `<span class="text-slate-500 text-sm italic">No reports appended.</span>`;
    document.getElementById('patientModal').classList.remove('hidden');
}

window.saveArchiveEdits = async () => {
    if (!activeArchiveEditId) return;
    const btn = document.getElementById('modalSaveEditsBtn'); btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1.5"></i> Saving...'; btn.disabled = true;
    
    const payload = {
        consultationId: activeArchiveEditId, 
        symptoms: document.getElementById('modalSymptoms').innerText, 
        prescribedMedications: document.getElementById('modalMedications').innerText, 
        aiDiagnosis: document.getElementById('modalDiagnosis').innerText,
        heartRate: document.getElementById('editHR').value, bloodPressure: document.getElementById('editBP').value, temperature: document.getElementById('editTemp').value, spo2: document.getElementById('editSpO2').value, bloodSugar: document.getElementById('editSugar').value, weight: document.getElementById('editWeight').value, height: document.getElementById('editHeight').value
    };

    const editFileInput = document.getElementById('editDocumentUpload');
    if (editFileInput && editFileInput.files.length > 0) { payload.documentsUrl = await uploadToCloudinary(editFileInput.files[0]); }

    try {
        const res = await fetch('/api/patients/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if ((await res.json()).success) { alert("Archive Record Updated!"); window.loadHistory(); window.closeModal(); } else alert("Failed to update.");
    } catch (e) { alert("Network Error"); }
    btn.innerHTML = '<i class="fas fa-save mr-1.5"></i> Save Edits'; btn.disabled = false;
}
window.closeModal = () => { activeArchiveEditId = null; document.getElementById('patientModal').classList.add('hidden'); }

// --- PERSISTENT CLINICAL MESSENGER --------
let activeChatConsultId = null, activeChatTargetPhone = null, chatPollingInterval = null, chatAudioRecorder = null, chatAudioChunks = [], isChatRecording = false;

window.openPersistentChat = (consultId, targetPhone, targetName) => {
    if (consultId === 'LEGACY') return alert("Legacy cases do not support clinical messaging.");
    activeChatConsultId = consultId; activeChatTargetPhone = targetPhone;
    document.getElementById('chatTargetName').innerText = `Re: Case ${consultId} (${targetName})`;
    document.getElementById('persistentChatWrapper').classList.remove('translate-x-full');
    document.getElementById('chatOverlay').classList.remove('hidden');
    window.loadPersistentChatHistory(); chatPollingInterval = setInterval(window.loadPersistentChatHistory, 3000);
}

window.closePersistentChat = () => { activeChatConsultId = null; activeChatTargetPhone = null; clearInterval(chatPollingInterval); document.getElementById('persistentChatWrapper').classList.add('translate-x-full'); document.getElementById('chatOverlay').classList.add('hidden'); window.clearChatMedia(); }

window.loadPersistentChatHistory = async () => {
    if (!activeChatConsultId) return;
    try {
        const res = await fetch(`/api/chat/${activeChatConsultId}`);
        const messages = await res.json();
        const container = document.getElementById('persistentChatMessages');
        let html = '<div class="text-center text-xs text-slate-400 italic my-auto">End-to-end encrypted messaging via verified phone identifiers.</div>';
        if (messages.length > 0) {
            html = messages.map(m => {
                const isSelf = m.senderPhone === currentUserPhone; const align = isSelf ? 'self-end items-end' : 'self-start items-start'; const bg = isSelf ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-800';
                let mediaHtml = ''; if (m.mediaUrl) { if (m.isAudio) { mediaHtml = `<audio controls src="${m.mediaUrl}" class="w-48 h-8 mt-1 rounded"></audio>`; } else { mediaHtml = `<a href="${m.mediaUrl}" target="_blank"><img src="${m.mediaUrl}" class="w-40 rounded mt-1 shadow-sm border border-slate-200 object-cover" /></a>`; } }
                return `<div class="flex flex-col max-w-[85%] ${align}"><div class="${bg} px-3 py-2 rounded-xl shadow-sm text-sm whitespace-pre-wrap">${m.text || ''}${mediaHtml}</div><span class="text-[9px] text-slate-400 mt-1 mx-1">${new Date(m.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span></div>`;
            }).join('');
        }
        const isScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50; container.innerHTML = html; if (isScrolledToBottom || messages.length === 0) container.scrollTop = container.scrollHeight;
    } catch (err) {}
}

window.previewChatMedia = () => { const file = document.getElementById('chatMediaInput').files[0]; if (file) { document.getElementById('chatMediaName').innerText = file.name; document.getElementById('chatMediaPreview').classList.remove('hidden'); } }
window.clearChatMedia = () => { document.getElementById('chatMediaInput').value = ''; document.getElementById('chatMediaPreview').classList.add('hidden'); }

window.toggleChatAudioRecording = async () => {
    const btn = document.getElementById('chatMicBtn');
    if (!isChatRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); chatAudioRecorder = new MediaRecorder(stream); chatAudioChunks = [];
            chatAudioRecorder.ondataavailable = e => { if (e.data.size > 0) chatAudioChunks.push(e.data); };
            chatAudioRecorder.onstop = async () => {
                stream.getTracks().forEach(track => track.stop()); btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                try {
                    const audioUrl = await uploadToCloudinary(new File([new Blob(chatAudioChunks, { type: 'audio/webm' })], "voice_note.webm", { type: 'audio/webm' }));
                    await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consultationId: activeChatConsultId, senderPhone: currentUserPhone, receiverPhone: activeChatTargetPhone, text: 'Voice Note', mediaUrl: audioUrl, isAudio: true }) });
                    window.loadPersistentChatHistory();
                } catch (e) { alert("Failed to send voice note."); }
                btn.innerHTML = '<i class="fas fa-microphone text-lg"></i>'; btn.classList.replace('text-red-600', 'text-slate-400');
            };
            chatAudioRecorder.start(); isChatRecording = true; btn.innerHTML = '<i class="fas fa-stop-circle text-xl"></i>'; btn.classList.replace('text-slate-400', 'text-red-600');
        } catch (err) { alert("Microphone access denied."); }
    } else { chatAudioRecorder.stop(); isChatRecording = false; }
}

window.sendPersistentMessage = async () => {
    const input = document.getElementById('persistentChatInput'), text = input.value.trim(), mediaInput = document.getElementById('chatMediaInput');
    if (!text && mediaInput.files.length === 0) return;
    document.getElementById('chatSendBtn').innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; document.getElementById('chatSendBtn').disabled = true;
    try {
        let mediaUrl = ''; if (mediaInput.files.length > 0) mediaUrl = await uploadToCloudinary(mediaInput.files[0]);
        await fetch('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consultationId: activeChatConsultId, senderPhone: currentUserPhone, receiverPhone: activeChatTargetPhone, text: text, mediaUrl: mediaUrl, isAudio: false }) });
        input.value = ''; window.clearChatMedia(); window.loadPersistentChatHistory();
    } catch (e) { alert("Message failed to send."); }
    document.getElementById('chatSendBtn').innerHTML = '<i class="fas fa-paper-plane"></i>'; document.getElementById('chatSendBtn').disabled = false;
}

// --- PEERJS WEBRTC (VIDEO CALL ENGINE)  ---
let peer = null, currentCall = null, localStream = null, peerJsChatConnection = null;

window.joinManualTelehealth = () => {
    const roomId = document.getElementById('manualTelehealthRoomId').value.trim();
    if(!roomId) return alert("Enter a valid ID");
    
    document.getElementById('telehealthSetup').classList.add('hidden'); 
    
    const videoWrapper = document.getElementById('videoWrapper');
    document.getElementById('standaloneVideoAnchor').appendChild(videoWrapper);
    videoWrapper.classList.remove('hidden');
    window.launchVideoCall(roomId);
}

window.launchVideoCall = async (consultationId) => {
    if (!consultationId || consultationId === 'LEGACY') return alert("Invalid Consultation ID.");
    document.getElementById('activeRoomIdDisplay').innerText = consultationId;
    const waitUI = document.getElementById('videoWaitingText'), statusTxt = document.getElementById('videoStatusText');
    waitUI.classList.remove('hidden'); statusTxt.innerText = "Accessing secure cameras...";
    try { localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); document.getElementById('localVideo').srcObject = localStream; } 
    catch (err) { alert("Camera and Microphone access denied."); return window.endTelehealth(); }

    const myPeerId = currentRole === 'doctor' ? `doc-${consultationId}` : `pat-${consultationId}`;
    const targetPeerId = currentRole === 'doctor' ? `pat-${consultationId}` : `doc-${consultationId}`;
    peer = new Peer(myPeerId);
    peer.on('open', () => { statusTxt.innerText = "Waiting for participant to join..."; if (currentRole === 'patient') connectToDoctor(targetPeerId); });
    peer.on('call', (call) => { call.answer(localStream); handleCallStream(call); });
    peer.on('connection', (conn) => { setupInCallChatConnection(conn); });
    peer.on('error', (err) => { if (err.type === 'peer-unavailable' && currentRole === 'patient') { statusTxt.innerText = "Waiting for Doctor to enter the room..."; setTimeout(() => connectToDoctor(targetPeerId), 3000); } });
}

function connectToDoctor(targetId) { if(!peer || peer.destroyed) return; const call = peer.call(targetId, localStream); if(call) handleCallStream(call); const conn = peer.connect(targetId); setupInCallChatConnection(conn); }
function handleCallStream(call) { currentCall = call; call.on('stream', (remoteStream) => { document.getElementById('videoWaitingText').classList.add('hidden'); document.getElementById('remoteVideo').srcObject = remoteStream; }); call.on('close', () => { alert("Participant ended the call."); window.endTelehealth(); }); }
window.toggleMic = function() { if(!localStream) return; const audioTrack = localStream.getAudioTracks()[0]; audioTrack.enabled = !audioTrack.enabled; const btn = document.getElementById('btnMic'); if(audioTrack.enabled) { btn.innerHTML = '<i class="fas fa-microphone"></i>'; btn.classList.replace('bg-red-500', 'bg-slate-600'); } else { btn.innerHTML = '<i class="fas fa-microphone-slash"></i>'; btn.classList.replace('bg-slate-600', 'bg-red-500'); } }
window.toggleVideo = function() { if(!localStream) return; const videoTrack = localStream.getVideoTracks()[0]; videoTrack.enabled = !videoTrack.enabled; const btn = document.getElementById('btnCam'); if(videoTrack.enabled) { btn.innerHTML = '<i class="fas fa-video"></i>'; btn.classList.replace('bg-red-500', 'bg-slate-600'); } else { btn.innerHTML = '<i class="fas fa-video-slash"></i>'; btn.classList.replace('bg-slate-600', 'bg-red-500'); } }

function setupInCallChatConnection(conn) { peerJsChatConnection = conn; peerJsChatConnection.on('data', (data) => { appendInCallChatMessage(data.sender, data.text, false); document.getElementById('chatPanel').classList.remove('hidden'); }); }
window.toggleChat = () => document.getElementById('chatPanel').classList.toggle('hidden');
window.sendChatMessage = function() { const input = document.getElementById('chatInput'); const text = input.value.trim(); if (!text) return; if (peerJsChatConnection && peerJsChatConnection.open) { const senderName = currentRole === 'doctor' ? `Dr. ${currentUserName}` : currentUserName; peerJsChatConnection.send({ sender: senderName, text: text }); appendInCallChatMessage('You', text, true); input.value = ''; } else { alert("Wait for participant to connect."); } }
function appendInCallChatMessage(sender, text, isSelf) { const container = document.getElementById('chatMessages'), align = isSelf ? 'items-end' : 'items-start', bg = isSelf ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-800', nameLabel = isSelf ? '' : `<span class="text-[10px] text-slate-500 mb-0.5 ml-1">${sender}</span>`; container.innerHTML += `<div class="flex flex-col ${align} animate-fade-in">${nameLabel}<div class="${bg} px-3 py-2 rounded-xl max-w-[85%] shadow-sm whitespace-pre-wrap">${text}</div></div>`; container.scrollTop = container.scrollHeight; }

window.endTelehealth = () => {
    if (currentCall) currentCall.close(); 
    if (peerJsChatConnection) { peerJsChatConnection.close(); peerJsChatConnection = null; } 
    if (peer) peer.destroy(); 
    if (localStream) localStream.getTracks().forEach(track => track.stop()); 
    
    currentCall = null; peer = null; localStream = null; 
    document.getElementById('remoteVideo').srcObject = null; document.getElementById('localVideo').srcObject = null;
    document.getElementById('btnMic').innerHTML = '<i class="fas fa-microphone"></i>'; document.getElementById('btnMic').className = 'w-10 h-10 bg-slate-600 hover:bg-slate-500 text-white rounded-full flex items-center justify-center transition-colors shadow text-sm';
    document.getElementById('btnCam').innerHTML = '<i class="fas fa-video"></i>'; document.getElementById('btnCam').className = 'w-10 h-10 bg-slate-600 hover:bg-slate-500 text-white rounded-full flex items-center justify-center transition-colors shadow text-sm';
    document.getElementById('chatMessages').innerHTML = '<div class="text-center text-[9px] text-slate-400 italic mb-1">P2P Private Chat</div>'; 
    document.getElementById('chatPanel').classList.add('hidden');
    
    const videoWrapper = document.getElementById('videoWrapper');
    videoWrapper.classList.add('hidden');
    document.getElementById('standaloneVideoAnchor').appendChild(videoWrapper);
    
    document.getElementById('telehealthSetup').classList.remove('hidden');
    document.getElementById('manualTelehealthRoomId').value = '';
}
