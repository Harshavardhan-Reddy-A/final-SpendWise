// manager.js

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

// Element selection
const totalIncomeEl = document.getElementById('totalIncome'); 
const totalSpentEl = document.getElementById("totalSpent");
const netChangeEl = document.getElementById("netChange");
const balanceAlertEl = document.getElementById("balanceAlert");
const wastedContentEl = document.getElementById("wastedContent");
// The canvas element is now correctly referenced in the HTML
const categoryTrendCanvas = document.getElementById("categoryTrendCanvas"); 

// Waste categories are defined here
const WASTE_CATEGORY_MATCHES = [
    'Luxury Items', 'Jewelry', 'Vacation', 'Pub', 'Liquor Store', 'Dining Out', 'Entertainment'
];
const WASTE_DESCRIPTION_KEYWORDS = [
    'swiggy', 'uber', 'zomato', 'bar', 'delivery', 'coffee', 'cab'
];

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
];

// Color palette (Black/White/Green/Red)
const GREEN_COLOR = '#28a745'; 
const RED_COLOR = '#dc3545'; 
const BLACK_COLOR = '#000000';
const LIGHT_GRAY_COLOR = '#e0e0e0';
// Updated TREND_COLORS for more distinct lines
const TREND_COLORS = ['#28a745', '#007bff', '#dc3545', '#ffc107', '#17a2b8']; 

let allBankData = []; 
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
            } else if (!user && !localStorage.getItem('currentUser')) { // Added local storage check
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
                Amount: parseFloat(amountString) || 0,
                DateObj: dateObj,
                Year: dateObj.getFullYear(),
                Month: dateObj.getMonth() + 1,
                Description: data.Description || data.Category || '', 
            };
        });
        
        if (allBankData.length > 0) {
            initializePeriodSelectors();
            updateScopeVisibility(); 
        } else {
            updateDashboard(0, 'N/A', 'N/A', 'monthly');
            analyzeWastedSpending([]);
            calculateNetChangeAndBalance([]); 
            renderCategorySpendingLineGraph([], 'monthly');
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
                    Amount: parseFloat(amountString) || 0,
                    DateObj: dateObj,
                    Year: dateObj.getFullYear(),
                    Month: dateObj.getMonth() + 1,
                    Description: row.Description || row.Category || '', 
                };
            });
            if (allBankData.length > 0) {
                initializePeriodSelectors();
                updateScopeVisibility(); 
            }
        } catch (error) {
            console.error("Error loading localStorage data:", error);
        }
    }
}


// --- Financial Logic ---

function calculateNetChangeAndBalance(data) {
    // 1. Calculate Total Income
    const totalIncome = data
        .filter(d => d.Category === 'Income' && d.Amount > 0)
        .reduce((sum, d) => sum + d.Amount, 0);

    // 2. Calculate Total Spent (excluding Income, Savings, and Transfer)
    const totalSpent = data
        .filter(d => d.Amount > 0 && d.Category !== 'Income' && d.Category !== 'Savings' && d.Category !== 'Transfer')
        .reduce((sum, d) => sum + d.Amount, 0);

    // 3. Calculate Net Change (Income - Expenditure)
    const netChangeValue = totalIncome - totalSpent;
    
    // 4. Update Income and Spent Display
    totalIncomeEl.textContent = `$${totalIncome.toFixed(2)}`;
    totalSpentEl.textContent = `$${totalSpent.toFixed(2)}`;

    // 5. Update Net Change Display
    netChangeEl.textContent = `$${netChangeValue.toFixed(2)}`;
    netChangeEl.classList.remove('positive', 'negative');
    netChangeEl.classList.add(netChangeValue >= 0 ? 'positive' : 'negative');

    // 6. Update Financial Health Monitor (Using a simple 50% spending threshold against income)
    const SPENDING_INCOME_THRESHOLD = 0.5;
    let alertHtml = '';
    
    if (totalIncome > 0 && totalSpent > totalIncome) {
        alertHtml = `<p class="alert-warning">Critical: Your expenditure ($${totalSpent.toFixed(2)}) is exceeding your total income ($${totalIncome.toFixed(2)})! Net Change: $${netChangeValue.toFixed(2)}.</p>`;
    } else if (totalIncome > 0 && totalSpent > totalIncome * SPENDING_INCOME_THRESHOLD) {
        const spentPercentage = ((totalSpent / totalIncome) * 100).toFixed(1);
        alertHtml = `<p class="alert-warning">Monitor: Your expenditure (${spentPercentage}%) is above the 50% threshold. Net Change: $${netChangeValue.toFixed(2)}.</p>`;
    } else if (totalIncome === 0 && totalSpent > 0) {
        alertHtml = `<p class="alert-warning">Monitor: No income recorded for this period. Spending is $${totalSpent.toFixed(2)}.</p>`;
    } else {
        const spentPercentage = totalIncome > 0 ? ((totalSpent / totalIncome) * 100).toFixed(1) : 0;
        alertHtml = `<p class="alert-success">Healthy: Total expenditure (${spentPercentage}%) is well managed. Net Change: $${netChangeValue.toFixed(2)}.</p>`;
    }
    balanceAlertEl.innerHTML = alertHtml;

    return totalSpent;
}


function updateDashboard(totalSpent, year, monthName, scope) {
    let summaryText = 'Financial Summary';
    if (scope === 'monthly') {
        summaryText = `Monthly Financial Report (${monthName} ${year})`;
    } else if (scope === 'yearly') {
        summaryText = `Annual Financial Report (${year})`;
    }
    document.getElementById('summaryTitle').textContent = summaryText;
}

// Function to analyze wasteful spending (Groups by Category)
function analyzeWastedSpending(data) {
    if (!data || data.length === 0) {
        wastedContentEl.innerHTML = "<p>No expenses found this period to analyze discretionary spending.</p>";
        return;
    }

    const wasteData = data.filter(d => 
        d.Amount > 0 && 
        d.Category && 
        d.Category !== 'Income' && 
        d.Category !== 'Savings' && 
        d.Category !== 'Transfer' 
    ).filter(d => {
        const categoryMatch = WASTE_CATEGORY_MATCHES.includes(d.Category);
        const descriptionText = (d.Description || '').toLowerCase();
        const descriptionMatch = WASTE_DESCRIPTION_KEYWORDS.some(keyword => 
            descriptionText.includes(keyword.toLowerCase())
        );

        return categoryMatch || descriptionMatch;
    });

    if (wasteData.length === 0) {
        wastedContentEl.innerHTML = "<p>Outstanding! No significant highly discretionary spending activities were flagged for this period.</p>";
        return;
    }

    const wasteSummary = wasteData.reduce((acc, item) => {
        let categoryName = item.Category || 'Uncategorized Discretionary'; 
        
        if (!WASTE_CATEGORY_MATCHES.includes(item.Category)) {
             const descriptionText = (item.Description || '').toLowerCase();
             const matchedKeyword = WASTE_DESCRIPTION_KEYWORDS.find(keyword => 
                descriptionText.includes(keyword.toLowerCase())
             );
             if (matchedKeyword) {
                 categoryName = `Keyword Match: ${matchedKeyword.charAt(0).toUpperCase() + matchedKeyword.slice(1)}`;
             }
        }
        
        acc[categoryName] = (acc[categoryName] || 0) + item.Amount;
        return acc;
    }, {});


    const sortedWaste = Object.entries(wasteSummary).sort(([, a], [, b]) => b - a);
    const totalWaste = sortedWaste.reduce((sum, [, amount]) => sum + amount, 0);

    let html = `<p>A total of <strong>$${totalWaste.toFixed(2)}</strong> was spent on the following highly discretionary activities this period:</p>`;
    html += '<ul class="waste-list">';
    
    sortedWaste.forEach(([category, amount]) => {
        const percentage = ((amount / totalWaste) * 100).toFixed(1);
        
        html += `<li style="margin-bottom: 8px;">
            <strong style="color: ${RED_COLOR};">$${amount.toFixed(2)}</strong> spent on <strong>${category}</strong> (${percentage}%)
            <div class="progress-bar-container">
                <div class="progress-bar" style="width: ${percentage}%; background-color: ${RED_COLOR};"></div>
            </div>
        </li>`;
    });
    html += '</ul>';

    wastedContentEl.innerHTML = html;
}

// --- Line Graph Rendering (UPDATED FOR SCATTER/LINE PLOT WITH LEGEND) ---

function renderCategorySpendingLineGraph(data, scope) {
    const canvas = document.getElementById("categoryTrendCanvas");
    const legendDiv = document.getElementById("trendLegend");
    
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Group data by period (Month for Yearly scope, Day for Monthly scope)
    const dateMap = data.reduce((acc, item) => {
        if (item.Amount > 0 && item.Category !== 'Income' && item.Category !== 'Savings' && item.Category !== 'Transfer') {
            const dateKey = scope === 'yearly' ? `${item.Year}-${item.Month.toString().padStart(2, '0')}` : item.Date;
            const label = scope === 'yearly' ? `${MONTH_NAMES[item.Month - 1]}` : item.Date.substring(5, 10);
            
            if (!acc[dateKey]) {
                acc[dateKey] = { categories: {}, label, dateKey };
            }
            acc[dateKey].categories[item.Category] = (acc[dateKey].categories[item.Category] || 0) + item.Amount;
        }
        return acc;
    }, {});
    
    const sortedDates = Object.values(dateMap).sort((a, b) => {
        return a.dateKey.localeCompare(b.dateKey);
    });
    
    if (sortedDates.length < 2) {
        legendDiv.innerHTML = '';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = 'center';
        ctx.fillStyle = GRAY_COLOR;
        ctx.fillText("Insufficient data for trend visualization (Need at least two periods).", canvas.width / 2, canvas.height / 2);
        return;
    }
    
    const labels = sortedDates.map(d => d.label);
    const allCategories = [...new Set(data.filter(d => d.Category !== 'Income' && d.Category !== 'Savings' && d.Category !== 'Transfer').map(d => d.Category))];

    const totalSpendingByCat = allCategories.reduce((acc, cat) => {
        acc[cat] = data.filter(d => d.Category === cat).reduce((sum, d) => sum + d.Amount, 0);
        return acc;
    }, {});

    const topCategories = Object.entries(totalSpendingByCat)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([cat]) => cat);


    const datasets = topCategories.map((category, index) => {
        const dataPoints = sortedDates.map(date => date.categories[category] || 0);
        const color = TREND_COLORS[index % TREND_COLORS.length];
        
        return {
            label: category,
            data: dataPoints,
            borderColor: color,
            backgroundColor: color + '33', 
            borderWidth: 2,
            pointRadius: 4,
            fill: false,
            tension: 0.3
        };
    });
    
    const PADDING = 40;
    // We rely on CSS for the height: 300px, but width should be full container width
    const width = canvas.parentNode.offsetWidth;
    const height = canvas.height;
    
    canvas.width = width;
    canvas.height = height;

    const chartWidth = width - 2 * PADDING;
    const chartHeight = height - 2 * PADDING;
    const allAmounts = datasets.flatMap(d => d.data);
    const maxAmount = Math.max(...allAmounts) * 1.1; 

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Axes
    ctx.strokeStyle = LIGHT_GRAY_COLOR;
    ctx.beginPath();
    ctx.moveTo(PADDING, PADDING); 
    ctx.lineTo(PADDING, height - PADDING); 
    ctx.lineTo(width - PADDING, height - PADDING);
    ctx.stroke();

    // 2. Draw Y-Axis Labels and Grid Lines
    ctx.fillStyle = BLACK_COLOR;
    ctx.textAlign = 'right';
    ctx.font = '10px Inter';
    const yTickCount = 4;
    for (let i = 0; i <= yTickCount; i++) {
        const yValue = (maxAmount / yTickCount) * i;
        const yPos = height - PADDING - (chartHeight / yTickCount) * i;

        ctx.beginPath();
        ctx.strokeStyle = '#f0f0f0';
        ctx.moveTo(PADDING, yPos);
        ctx.lineTo(width - PADDING, yPos);
        ctx.stroke();

        ctx.fillStyle = BLACK_COLOR;
        ctx.fillText(`$${yValue.toFixed(0)}`, PADDING - 5, yPos + 4);
    }

    // 3. Draw X-Axis Labels
    ctx.textAlign = 'center';
    const xStep = chartWidth / (labels.length - 1 || 1);
    labels.forEach((label, i) => {
        const xPos = PADDING + xStep * i;
        ctx.save();
        ctx.translate(xPos, height - PADDING + 5);
        ctx.rotate(-Math.PI / 4);
        ctx.fillStyle = BLACK_COLOR;
        ctx.fillText(label, 0, 0);
        ctx.restore();
    });

    // 4. Draw Data Lines and Points
    datasets.forEach(dataset => {
        ctx.beginPath();
        ctx.strokeStyle = dataset.borderColor;
        ctx.lineWidth = dataset.borderWidth;

        dataset.data.forEach((amount, i) => {
            const xPos = PADDING + xStep * i;
            const yPos = height - PADDING - (amount / maxAmount) * chartHeight;
            
            if (i === 0) {
                ctx.moveTo(xPos, yPos);
            } else {
                ctx.lineTo(xPos, yPos);
            }
            
            ctx.fillStyle = dataset.borderColor;
            ctx.beginPath();
            ctx.arc(xPos, yPos, dataset.pointRadius, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.stroke();
    });

    // 5. Render Legend
    legendDiv.innerHTML = datasets.map(dataset => `
        <div class="legend-item">
            <span class="legend-color" style="background-color: ${dataset.borderColor};"></span>
            <span>${dataset.label}</span>
        </div>
    `).join('');
}


// Controls visibility of selectors based on analysis scope
function updateScopeVisibility() {
    const scope = document.getElementById("scopeSelect").value;
    const monthContainer = document.getElementById("monthSelectorContainer");

    if (scope === 'yearly') {
        monthContainer.style.display = 'none';
    } else { 
        monthContainer.style.display = 'flex';
    }
    filterAndRender();
}


// Populate year and month selectors based on data (Same as before)
function initializePeriodSelectors() {
    const yearSelect = document.getElementById("yearSelect");
    const monthSelect = document.getElementById("monthSelect");
    
    yearSelect.innerHTML = '';
    
    const uniqueYears = [...new Set(allBankData.map(d => d.Year))].sort((a, b) => b - a);
    uniqueYears.forEach(year => {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    });
    
    monthSelect.innerHTML = MONTH_NAMES.map(month => `<option value="${month}">${month}</option>`).join('');

    if (uniqueYears.length > 0) {
        const latestYear = uniqueYears[0];
        const latestMonth = Math.max(...allBankData.filter(d => d.Year === latestYear).map(d => d.Month));
        
        yearSelect.value = latestYear;
        monthSelect.value = MONTH_NAMES[latestMonth - 1]; 
    }
}

// Filter data and calculate total spent for the selected period
function filterAndRender() {
    const scope = document.getElementById("scopeSelect").value;
    const yearSelect = document.getElementById("yearSelect");
    const monthSelect = document.getElementById("monthSelect");
    
    if (yearSelect.value === '') { 
        updateDashboard(0, 'N/A', 'N/A', scope);
        analyzeWastedSpending([]);
        calculateNetChangeAndBalance([]); 
        renderCategorySpendingLineGraph([], scope); 
        return;
    }
    
    const year = parseInt(yearSelect.value);
    
    let currentFilteredData = allBankData.filter(d => d.Year === year);
    let monthName = '';

    if (scope === 'monthly') {
        monthName = monthSelect.value;
        if (monthName === '') {
            updateDashboard(0, year, 'N/A', scope);
            analyzeWastedSpending(currentFilteredData);
            calculateNetChangeAndBalance(currentFilteredData); 
            renderCategorySpendingLineGraph(allBankData, scope); // Still use all data for trend
            return;
        }
        const month = MONTH_NAMES.indexOf(monthName) + 1; 
        currentFilteredData = currentFilteredData.filter(d => d.Month === month);
    }
    
    const totalSpent = calculateNetChangeAndBalance(currentFilteredData); 
    updateDashboard(totalSpent, year, monthName, scope);
    analyzeWastedSpending(currentFilteredData); 
    // Always use all data for trend graph to show history
    renderCategorySpendingLineGraph(allBankData, scope);
}


document.addEventListener("DOMContentLoaded", () => {
    // Attach event listeners for dynamic updates
    document.getElementById("scopeSelect").addEventListener("change", updateScopeVisibility);
    document.getElementById("yearSelect").addEventListener("change", filterAndRender);
    document.getElementById("monthSelect").addEventListener("change", filterAndRender);
    
    // Initial call to ensure graph renders on load
    initializeFirebaseAndAuth(); 
});