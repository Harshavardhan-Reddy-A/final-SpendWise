// upload.js (Now the logic for upload.html)

import { 
    getAuth, 
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    query,
    getDocs,
    deleteDoc
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const fileMessage = document.getElementById('file-message');

const BLACK_COLOR = '#000000';

let app, auth, db, userId, appId;

// --- CONFIG FETCHING UTILITY ---
async function fetchConfig() {
    try {
        const response = await fetch('config.json');
        if (!response.ok) {
            throw new Error(`Failed to load config.json: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Configuration Fetch Error:", error);
        fileMessage.textContent = 'System Error: Configuration file missing. Using local storage fallback.';
        fileMessage.style.color = '#dc3545';
        uploadBtn.disabled = false;
        return { appId: 'local-fallback', firebaseConfig: {} }; 
    }
}

// --- Firebase Initialization and Auth Check ---

async function initializeFirebaseAndAuth() {
    const config = await fetchConfig();
    appId = config.appId || 'local-fallback';
    const firebaseConfig = config.firebaseConfig || {};
    
    try {
        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase config is missing. Upload will use localStorage (not persistent).");
            fileMessage.textContent = 'Warning: Using local storage. Data is not persistent.';
            uploadBtn.disabled = false;
            return;
        }

        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        onAuthStateChanged(auth, (user) => {
            if (user && user.email) {
                userId = user.uid;
                uploadBtn.disabled = !fileInput.files.length;
            } else {
                // REDIRECT to new index.html (Login)
                if (!localStorage.getItem('currentUser')) {
                    window.location.href = 'index.html'; 
                }
            }
        });

    } catch (error) {
        console.error("Error during Firebase initialization/auth setup:", error);
        fileMessage.textContent = `System Error: ${error.message}`;
        fileMessage.style.color = '#dc3545';
    }
}

// --- Data Persistence Logic ---

async function saveBankDataToFirestore(data) {
    if (!db || !userId || appId === 'local-fallback') {
        // Fallback to localStorage for testing purposes
        localStorage.setItem("bankData", JSON.stringify(data));
        console.warn("Using localStorage fallback.");
        return true;
    }

    const statementsCollection = collection(db, "artifacts", appId, "users", userId, "bank_statements");
    
    // 1. Clear existing data for the user
    const q = query(statementsCollection);
    const snapshot = await getDocs(q);
    
    const deletePromises = snapshot.docs.map(d => deleteDoc(d.ref));
    await Promise.all(deletePromises);
    console.log(`Cleared ${snapshot.size} old records.`);


    // 2. Upload new data (one document per row)
    const uploadPromises = data.map(row => {
        return addDoc(statementsCollection, row);
    });

    await Promise.all(uploadPromises);
    console.log(`Uploaded ${data.length} new records.`);
    return true;
}

// --- CSV Parsing Logic ---

function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length === 0) throw new Error("File is empty.");
    
    const headers = lines[0].split(',').map(h => h.trim());
    const expectedHeaders = ['Date', 'Category', 'Amount', 'Description'];

    const hasRequiredHeaders = expectedHeaders.every(h => headers.includes(h));
    if (!hasRequiredHeaders) {
        throw new Error(`CSV is missing required headers: ${expectedHeaders.join(', ')}`);
    }

    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length === headers.length) {
            let obj = {};
            headers.forEach((header, index) => {
                let value = values[index];
                
                if (header.toLowerCase() === 'amount') {
                    let cleanedValue = value.replace(/[^0-9.-]/g, ''); 
                    obj[header] = parseFloat(cleanedValue) || 0; 
                } else {
                    obj[header] = value;
                }
            });
            data.push(obj);
        }
    }
    return data;
}


// --- Event Listeners ---

fileInput.addEventListener('change', () => {
    uploadBtn.disabled = !fileInput.files.length;
    fileMessage.textContent = '';
});

uploadBtn.addEventListener('click', async () => {
    if(fileInput.files.length > 0){
        const file = fileInput.files[0];

        if(file.name.endsWith(".csv")) {
            fileMessage.textContent = 'Processing file...';
            fileMessage.style.color = BLACK_COLOR; 
            uploadBtn.disabled = true;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const dataArray = parseCSV(e.target.result);
                    
                    const success = await saveBankDataToFirestore(dataArray);

                    if (success) {
                        window.location.href = "manager.html";
                    } else {
                         fileMessage.textContent = `Error: Failed to save data.`;
                         fileMessage.style.color = '#dc3545';
                    }

                } catch (error) {
                    fileMessage.textContent = `Error: ${error.message}`;
                    fileMessage.style.color = '#dc3545';
                    console.error("CSV Processing Error:", error);
                    uploadBtn.disabled = false;
                }
            };
            reader.readAsText(file);
        } else {
            fileMessage.textContent = "Please upload a CSV bank statement.";
            fileMessage.style.color = '#dc3545';
        }
    }
});

document.addEventListener('DOMContentLoaded', initializeFirebaseAndAuth);