// prediction.js

import { 
    getAuth, 
    onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    onSnapshot,
    query
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const runForecastBtn = document.getElementById("runForecastBtn");
const predictionResultContent = document.getElementById("predictionResultContent");
const modelDetailsContent = document.getElementById("modelDetailsContent");

const GREEN_COLOR = '#28a745';
const RED_COLOR = '#dc3545';
const BLACK_COLOR = '#000000';

let allBankData = []; 
let categoryMonthlyData = {}; 
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
        // Fallback for content pages when config is missing
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
            console.error("Firebase config is missing. Using local storage fallback.");
            loadDataFromLocalStorage();
            return;
        }

        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        onAuthStateChanged(auth, (user) => {
            if (user && user.email) {
                userId = user.uid;
                fetchBankData();
            } else if (!user) {
                window.location.href = 'login.html'; 
            }
        });

    } catch (error) {
        console.error("Error during Firebase initialization/auth setup:", error);
    }
}

// --- Data Fetching Logic (ON SNAPSHOT) ---

function fetchBankData() {
    if (!db || !userId) return;

    const statementsCollectionRef = collection(db, "artifacts", appId, "users", userId, "bank_statements");
    const q = query(statementsCollectionRef);

    onSnapshot(q, (snapshot) => {
        allBankData = snapshot.docs.map(doc => {
            const data = doc.data();
            const dateObj = new Date(data.Date);
            
            // Ensure Amount is parsed as float
            let amountString = String(data.Amount).replace(/[^0-9.-]/g, ''); 
            
            return {
                ...data,
                DateObj: dateObj,
                Year: dateObj.getFullYear(),
                Month: dateObj.getMonth() + 1,
                Amount: parseFloat(amountString) || 0,
            };
        });
        
        categoryMonthlyData = getMonthlyCategorySpendingData(allBankData);
        const validCategories = Object.keys(categoryMonthlyData).length;

        // Ensure runForecastBtn only gets added once
        if (!runForecastBtn.hasListener) {
            runForecastBtn.addEventListener("click", runForecastPrediction);
            runForecastBtn.hasListener = true;
        }
        
        if (validCategories === 0) {
            predictionResultContent.innerHTML = `<p style="color: ${RED_COLOR};">Insufficient historical data. Need at least 2 months of expense data in two or more categories for the prediction model.</p>`;
            runForecastBtn.disabled = true;
        } else {
            predictionResultContent.innerHTML = `<p style="color:${BLACK_COLOR};">Found ${validCategories} categories with sufficient historical data. Click "Run Linear Regression Forecast" to calculate individual trends.</p>`;
            runForecastBtn.disabled = false;
        }

    }, (error) => {
        console.error("Error fetching bank data:", error);
    });
}

// Fallback for local storage (for testing purposes)
function loadDataFromLocalStorage() {
    const savedData = localStorage.getItem("bankData");
    if (savedData) {
        try {
            allBankData = JSON.parse(savedData).map(row => {
                const dateObj = new Date(row.Date);
                let amountString = String(row.Amount).replace(/[^0-9.-]/g, ''); 
                return {
                    ...row,
                    DateObj: dateObj,
                    Year: dateObj.getFullYear(),
                    Month: dateObj.getMonth() + 1,
                    Amount: parseFloat(amountString) || 0,
                };
            });
             categoryMonthlyData = getMonthlyCategorySpendingData(allBankData);
             const validCategories = Object.keys(categoryMonthlyData).length;
             
             if (!runForecastBtn.hasListener) {
                runForecastBtn.addEventListener("click", runForecastPrediction);
                runForecastBtn.hasListener = true;
             }
             
             if (validCategories === 0) {
                predictionResultContent.innerHTML = `<p style="color: ${RED_COLOR};">Insufficient historical data (using local storage fallback).</p>`;
                runForecastBtn.disabled = true;
            } else {
                predictionResultContent.innerHTML = `<p style="color:${BLACK_COLOR};">Loaded ${validCategories} categories from local storage. Click "Run Linear Regression Forecast" to calculate individual trends.</p>`;
                runForecastBtn.disabled = false;
            }
        } catch (error) {
            console.error("Error loading localStorage data:", error);
        }
    }
}


// --- PURE JS LINEAR REGRESSION CORE (Unchanged) ---
function calculateLinearRegression(data) {
    if (data.length < 2) {
        return { m: 0, b: data.length > 0 ? data[0].amount : 0, mse: 0 };
    }
    
    const n = data.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;

    data.forEach(d => {
        const x = d.sequence;
        const y = d.amount;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
    });

    const denominator = (n * sumXX - sumX * sumY);
    if (denominator === 0) {
         return { m: 0, b: sumY / n, mse: 0 }; 
    }

    const m = (n * sumXY - sumX * sumY) / denominator;
    const b = (sumY - m * sumX) / n;

    let mse = 0;
    data.forEach(d => {
        const predictedY = m * d.sequence + b;
        mse += Math.pow(predictedY - d.amount, 2);
    });
    mse /= n;

    return { m, b, mse };
}

function predictSpending(sequence, m, b) {
    const predictedAmount = m * sequence + b;
    return Math.max(0, predictedAmount); 
}
// --- END PURE JS CORE ---


function getMonthlyCategorySpendingData(data) {
    const spendingMap = data.filter(d => 
        d.Category && d.Category !== 'Income' && d.Category !== 'Savings' && d.Category !== 'Transfer'
    ).reduce((acc, item) => {
        const itemAmount = Number(item.Amount) || 0; 
        const category = item.Category;
        
        if (itemAmount > 0) {
            const monthKey = `${item.Year}-${item.Month.toString().padStart(2, '0')}`;
            
            if (!acc[category]) {
                acc[category] = {};
            }
            
            acc[category][monthKey] = {
                amount: (acc[category][monthKey] ? acc[category][monthKey].amount : 0) + itemAmount,
                year: item.Year,
                month: item.Month
            };
        }
        return acc;
    }, {});
    
    const result = {};
    const allMonths = new Set();
    Object.values(spendingMap).forEach(categoryMonths => {
        Object.keys(categoryMonths).forEach(monthKey => allMonths.add(monthKey));
    });
    const sortedMonths = Array.from(allMonths).sort();
    const monthSequenceMap = sortedMonths.reduce((map, monthKey, index) => {
        map[monthKey] = index + 1;
        return map;
    }, {});
    
    Object.keys(spendingMap).forEach(category => {
        const categoryMonths = spendingMap[category];
        const categoryData = Object.keys(categoryMonths).sort().map(monthKey => {
            const dataPoint = categoryMonths[monthKey];
            
            return {
                sequence: monthSequenceMap[monthKey], 
                month_of_year: Number(dataPoint.month) || 0, 
                year: Number(dataPoint.year) || 0, 
                amount: Number(dataPoint.amount) || 0
            };
        });
        
        if (categoryData.length >= 2) {
            result[category] = categoryData;
        }
    });

    return result; 
}

// 2. Training and Prediction Logic (Pure JS - Updated colors)
function runForecastPrediction() {
    try {
        const categories = Object.keys(categoryMonthlyData);
        if (categories.length === 0) { 
            predictionResultContent.innerHTML = `<p style="color: ${RED_COLOR};">Need at least 2 months of historical data in at least two categories to calculate a trend line.</p>`;
            return;
        }
        
        runForecastBtn.disabled = true;
        predictionResultContent.innerHTML = `<p style="color:${BLACK_COLOR};">Calculating Linear Regression Trend for ${categories.length} categories...</p>`;
        
        const allSequences = Object.values(categoryMonthlyData).flatMap(arr => arr.map(d => d.sequence));
        const maxSequence = allSequences.length > 0 ? Math.max(...allSequences) : 0;
        
        const nextSequence = maxSequence + 1; 
        
        let resultsHtml = `<table class="prediction-table">
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Next Month Forecast</th>
                    <th>Next 12-Month Projection</th>
                    <th>MSE Loss</th>
                </tr>
            </thead>
            <tbody>`;
        
        let totalForecastNextMonth = 0;
        let totalForecastNextYear = 0;
        
        categories.sort().forEach(category => {
            const data = categoryMonthlyData[category];

            const { m, b, mse } = calculateLinearRegression(data);
            
            const forecastedMonth = predictSpending(nextSequence, m, b);
            
            let sumPredictedMonths = 0;
            for (let i = 1; i <= 12; i++) {
                sumPredictedMonths += predictSpending(maxSequence + i, m, b);
            }
            const forecastedYear = sumPredictedMonths;
            
            totalForecastNextMonth += forecastedMonth;
            totalForecastNextYear += forecastedYear;

            // --- Render the results row ---
            resultsHtml += `
                <tr>
                    <td class="category-name">${category}</td>
                    <td class="forecast-value" style="color:${RED_COLOR};">$${forecastedMonth.toFixed(2)}</td>
                    <td class="forecast-value" style="color:${RED_COLOR};">$${forecastedYear.toFixed(2)}</td>
                    <td>${mse.toFixed(2)}</td>
                </tr>
            `;
        });
        
        resultsHtml += `
            <tr class="total-row">
                <td class="category-name"><strong>Total Projected Expenditure</strong></td>
                <td class="forecast-value" style="color:${GREEN_COLOR};"><strong>$${totalForecastNextMonth.toFixed(2)}</strong></td>
                <td class="forecast-value" style="color:${GREEN_COLOR};"><strong>$${totalForecastNextYear.toFixed(2)}</strong></td>
                <td>N/A</td>
            </tr>
        `;
        
        resultsHtml += `</tbody></table>`;
        
        predictionResultContent.innerHTML = resultsHtml;

        runForecastBtn.disabled = false;

    } catch (e) {
        console.error("FATAL ERROR during prediction:", e);
        predictionResultContent.innerHTML = `<p style="color: ${RED_COLOR};">FATAL ERROR during prediction. Error detail: ${e.message}</p>`;
        runForecastBtn.disabled = false;
    }
}


document.addEventListener("DOMContentLoaded", () => {
    initializeFirebaseAndAuth();
});