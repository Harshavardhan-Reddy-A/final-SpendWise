// analysis.js

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

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
];

const DAY_NAMES = [
    "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"
];

const GREEN_COLOR = '#28a745';
const RED_COLOR = '#dc3545';
const BLACK_COLOR = '#000000';
const GRAY_COLOR = '#666666';

// Colors for scatter plot points (must match TREND_COLORS in manager.js if reused)
const SCATTER_COLORS = ['#28a745', '#000000', '#dc3545', '#007bff', '#ffc107', '#6c757d', '#17a2b8', '#6f42c1'];

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
            } else if (!user && !localStorage.getItem('currentUser')) {
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
                WeekOfMonth: getWeekOfMonth(dateObj),
                // DayOfWeek: 0 (Sunday) to 6 (Saturday)
                DayOfWeek: dateObj.getDay(), 
                Description: data.Description || data.Category || '', 
            };
        });
        
        if (allBankData.length > 0) {
            initializePeriodSelectors();
            updateScopeVisibility(); 
        } else {
            document.querySelector('.main-area').innerHTML = '<p class="card full-width">No bank statement data available. Please upload a CSV on the Upload Data page.</p>';
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
                // Ensure Amount is parsed as float
                let amountString = String(row.Amount).replace(/[^0-9.-]/g, ''); 
                
                return {
                    ...row,
                    Amount: parseFloat(amountString) || 0,
                    DateObj: dateObj,
                    Year: dateObj.getFullYear(),
                    Month: dateObj.getMonth() + 1,
                    WeekOfMonth: getWeekOfMonth(dateObj),
                    DayOfWeek: dateObj.getDay(),
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


// Utility function to determine the week number of the month
function getWeekOfMonth(date) {
    const dayOfMonth = date.getDate();
    return Math.ceil(dayOfMonth / 7);
}


function initializePeriodSelectors() {
    const yearSelect = document.getElementById("yearSelect");
    const monthSelect = document.getElementById("monthSelect");
    
    // 1. Populate selectors (unchanged)
    const uniqueYears = [...new Set(allBankData.map(d => d.Year))].sort((a, b) => b - a);
    yearSelect.innerHTML = uniqueYears.map(year => `<option value="${year}">${year}</option>`).join('');
    
    monthSelect.innerHTML = MONTH_NAMES.map(month => `<option value="${month}">${month}</option>`).join('');

    const weekSelect = document.getElementById("weekSelect");
    weekSelect.innerHTML = `
        <option value="1">Week 1</option>
        <option value="2">Week 2</option>
        <option value="3">Week 3</option>
        <option value="4">Week 4</option>
        <option value="5">Week 5 (if applicable)</option>
    `;
    
    if (allBankData.length > 0) {
        // Find the latest date
        const latestDataPoint = allBankData.reduce((latest, current) => {
            return current.DateObj > latest.DateObj ? current : latest;
        });

        const latestYear = latestDataPoint.Year;
        const latestMonth = latestDataPoint.Month; // 1-indexed (1-12)

        let targetYear = latestYear;
        let targetMonth = latestMonth - 1; // 1-indexed

        // Adjust for wrap-around (January -> December of previous year)
        if (targetMonth === 0) {
            targetMonth = 12; // December
            targetYear -= 1; // Previous year
        }
        
        // We select the previous month IF that month exists in the unique year list.
        const targetYearExists = uniqueYears.includes(targetYear);
        const targetMonthName = MONTH_NAMES[targetMonth - 1]; // 0-indexed for array

        if (targetYearExists) {
            yearSelect.value = targetYear;
            monthSelect.value = targetMonthName;
        } else {
            // Fallback: If previous month/year combination doesn't exist (e.g., only one month of data)
            // Select the latest existing month
            yearSelect.value = latestYear;
            monthSelect.value = MONTH_NAMES[latestMonth - 1]; 
        }
    }
}

function updateScopeVisibility() {
    const scope = document.getElementById("scopeSelect").value;
    
    const yearContainer = document.getElementById("yearSelectorContainer");
    const monthContainer = document.getElementById("monthSelectorContainer");
    const weekContainer = document.getElementById("weekSelectorContainer");

    let titleText = scope.charAt(0).toUpperCase() + scope.slice(1);
    if (titleText === 'Yearly') titleText = 'Annual';
    document.getElementById("analysisTitle").textContent = titleText + " Financial Analysis";

    if (scope === 'yearly') {
        yearContainer.style.display = 'flex';
        monthContainer.style.display = 'none';
        weekContainer.style.display = 'none';
        document.getElementById("trendTitle").textContent = "Monthly Spending Trend";
    } else if (scope === 'monthly') {
        yearContainer.style.display = 'flex';
        monthContainer.style.display = 'flex';
        weekContainer.style.display = 'none';
        document.getElementById("trendTitle").textContent = "Weekly Spending Trend";
    } else if (scope === 'weekly') {
        yearContainer.style.display = 'flex';
        monthContainer.style.display = 'flex';
        weekContainer.style.display = 'flex';
        document.getElementById("trendTitle").textContent = "Daily Spending Trend";
    }
    filterAndRender();
}


function filterAndRender() {
    const scope = document.getElementById("scopeSelect").value;
    const year = parseInt(document.getElementById("yearSelect").value);
    const monthName = document.getElementById("monthSelect").value;
    const week = parseInt(document.getElementById("weekSelect").value);
    const month = MONTH_NAMES.indexOf(monthName) + 1; 

    let filteredData = allBankData;
    let trendGroupingKey = '';

    if (scope === 'yearly' || scope === 'monthly' || scope === 'weekly') {
        filteredData = filteredData.filter(d => d.Year === year);
    }
    if (scope === 'monthly' || scope === 'weekly') {
        filteredData = filteredData.filter(d => d.Month === month);
    }
    if (scope === 'weekly') {
        filteredData = filteredData.filter(d => d.WeekOfMonth === week);
    }

    if (scope === 'yearly') {
        trendGroupingKey = 'Month';
    } else if (scope === 'monthly') {
        trendGroupingKey = 'WeekOfMonth';
    } else if (scope === 'weekly') {
        trendGroupingKey = 'Date'; 
    }

    renderTable(filteredData);
    renderPieChart(filteredData);
    renderTrendGraph(filteredData, trendGroupingKey, scope);
    renderScatterPlot(filteredData); // NEW CALL
}


function renderTable(data) {
    const table = document.getElementById("statementTable");
    table.innerHTML = "";

    if (!data || data.length === 0) {
        table.innerHTML = "<thead><tr><th>Date</th><th>Category</th><th>Amount</th></tr></thead><tbody><tr><td colspan='4'>No data available for this selection.</td></tr></tbody>";
        return;
    }

    const headers = Object.keys(data[0]).filter(key => ['Date', 'Description', 'Category', 'Amount'].includes(key));
    let headerHtml = "<thead><tr>";
    headers.forEach(h => { headerHtml += `<th>${h}</th>`; });
    headerHtml += "</tr></thead>";
    
    let rowsHtml = "<tbody>";
    data.forEach(row => {
        let rowHtml = "<tr>";
        headers.forEach(h => {
            let cellContent = row[h];
            if (h === 'Amount') {
                cellContent = `$${row[h].toFixed(2)}`;
            }
            rowHtml += `<td>${cellContent}</td>`;
        });
        rowHtml += "</tr>";
        rowsHtml += rowHtml;
    });
    rowsHtml += "</tbody>";

    table.innerHTML = headerHtml + rowsHtml;
}


// Render Pie Chart (Category Spending) - Using Green/Gray for visualization
function renderPieChart(data) {
    const chartDiv = document.getElementById("pieChart");
    
    const spendingByCategory = data.reduce((acc, item) => {
        if (item.Amount > 0 && item.Category !== 'Income' && item.Category !== 'Savings' && item.Category !== 'Transfer') {
            acc[item.Category] = (acc[item.Category] || 0) + item.Amount;
        }
        return acc;
    }, {});
    
    const sortedCategories = Object.entries(spendingByCategory).sort(([, a], [, b]) => b - a);
    const totalExpense = sortedCategories.reduce((sum, [, amount]) => sum + amount, 0);

    if (totalExpense === 0) {
        chartDiv.innerHTML = "<p>No expenses found for this period.</p>";
        return;
    }
    
    let html = '<ul style="list-style-type: none; padding: 0; text-align: left;">';
    const COLOR = GREEN_COLOR; 

    sortedCategories.forEach(([category, amount]) => {
        const percentage = ((amount / totalExpense) * 100).toFixed(1);

        html += `<li style="margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.9em; margin-bottom: 3px;">
                <strong style="color: ${BLACK_COLOR};">${category}</strong>
                <span style="color: ${GRAY_COLOR};">$${amount.toFixed(2)} (${percentage}%)</span>
            </div>
            <div style="height: 10px; background-color: #eeeeee; border-radius: 5px;">
                <div style="width: ${percentage}%; height: 100%; background-color: ${COLOR}; border-radius: 5px; transition: width 0.5s ease-out;"></div>
            </div>
        </li>`;
    });
    html += '</ul>';
    chartDiv.innerHTML = html;
}


// Render Trend Graph (Weekly/Monthly/Daily Spending) - Green Bar Chart
function renderTrendGraph(data, groupingKey, scope) {
    const chartDiv = document.getElementById("trendGraph");

    if (!data || data.length === 0) {
        chartDiv.innerHTML = "<p>No spending data to visualize trends.</p>";
        return;
    }
    
    const spendingByPeriod = data.reduce((acc, item) => {
        if (item.Amount > 0 && item.Category !== 'Income' && item.Category !== 'Savings' && item.Category !== 'Transfer') {
            let key;
            if (groupingKey === 'Month') {
                key = MONTH_NAMES[item.Month - 1];
            } else if (groupingKey === 'WeekOfMonth') {
                key = `Week ${item.WeekOfMonth}`;
            } else if (groupingKey === 'Date') {
                key = item.Date.substring(5, 10); 
            }
            
            acc[key] = (acc[key] || 0) + item.Amount;
        }
        return acc;
    }, {});
    
    const sortedPeriods = Object.entries(spendingByPeriod).sort(([a], [b]) => {
        if (scope === 'yearly') return MONTH_NAMES.indexOf(a) - MONTH_NAMES.indexOf(b);
        if (scope === 'monthly') return parseInt(a.replace('Week ', '')) - parseInt(b.replace('Week ', ''));
        if (scope === 'weekly') return a.localeCompare(b);
        return 0;
    });

    const maxAmount = Math.max(...Object.values(spendingByPeriod));

    if (maxAmount === 0) {
        chartDiv.innerHTML = "<p>No expenses found for this period.</p>";
        return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 10px; padding: 10px; min-height: 200px;">';
    sortedPeriods.forEach(([period, amount]) => {
        const width = (amount / maxAmount) * 100;
        const barColor = GREEN_COLOR; 
        
        html += `<div style="display: flex; align-items: center; gap: 10px;">
            <div style="width: 80px; font-weight: 500; text-align: right; white-space: nowrap; font-size: 0.9em; color: ${GRAY_COLOR};">${period}:</div>
            <div style="flex-grow: 1; background-color: #eeeeee; height: 20px; border-radius: 5px;">
                <div style="width: ${width}%; height: 100%; background-color: ${barColor}; border-radius: 5px; display: flex; align-items: center; padding-left: 5px; box-sizing: border-box; min-width: 10px; transition: width 0.5s ease-out;">
                    <span style="font-size: 0.75em; color: white; font-weight: bold; text-shadow: 0 0 1px #333;">$${amount.toFixed(2)}</span>
                </div>
            </div>
        </div>`;
    });
    html += '</div>';
    
    chartDiv.innerHTML = html;
}

// NEW SCATTER PLOT FUNCTION
function renderScatterPlot(data) {
    const canvas = document.getElementById('scatterPlotCanvas');
    const legendDiv = document.getElementById('scatterLegend');
    const ctx = canvas.getContext('2d');
    
    const filteredData = data.filter(d => 
        d.Amount > 0 && 
        d.Category !== 'Income' && 
        d.Category !== 'Savings' && 
        d.Category !== 'Transfer'
    );
    
    if (filteredData.length === 0) {
        legendDiv.innerHTML = '';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = 'center';
        ctx.fillStyle = GRAY_COLOR;
        ctx.fillText("No expense transactions to plot.", canvas.width / 2, canvas.height / 2);
        return;
    }

    // Identify top categories for grouping/coloring
    const spendingByCategory = filteredData.reduce((acc, item) => {
        acc[item.Category] = (acc[item.Category] || 0) + item.Amount;
        return acc;
    }, {});
    
    const sortedCategories = Object.entries(spendingByCategory)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8) // Limit to top 8 categories
        .map(([category]) => category);

    const categoryMap = sortedCategories.reduce((map, category, index) => {
        map[category] = { 
            color: SCATTER_COLORS[index % SCATTER_COLORS.length], 
            data: [] 
        };
        return map;
    }, {});

    // Prepare plot data
    filteredData.forEach(d => {
        const category = d.Category;
        if (categoryMap[category]) {
            // X-axis: Day of the week (0=Sun to 6=Sat)
            // Y-axis: Transaction Amount
            categoryMap[category].data.push({ x: d.DayOfWeek, y: d.Amount, category: category });
        }
    });

    const PADDING = 20;
    const width = canvas.width;
    const height = canvas.height;
    
    const maxAmount = Math.max(...filteredData.map(d => d.Amount)) * 1.1; 
    
    ctx.clearRect(0, 0, width, height);
    
    // --- Draw Axes and Grid ---
    ctx.strokeStyle = GRAY_COLOR;
    ctx.lineWidth = 1;

    // Y-Axis (Amount)
    ctx.beginPath();
    ctx.moveTo(PADDING, PADDING); 
    ctx.lineTo(PADDING, height - PADDING); 
    ctx.stroke();

    // X-Axis (Day)
    ctx.beginPath();
    ctx.moveTo(PADDING, height - PADDING);
    ctx.lineTo(width - PADDING, height - PADDING);
    ctx.stroke();

    const plotWidth = width - 2 * PADDING;
    const plotHeight = height - 2 * PADDING;
    const xStep = plotWidth / 6; // 0 to 6 (7 days)

    // X-Axis Labels (Day of Week)
    ctx.textAlign = 'center';
    ctx.fillStyle = BLACK_COLOR;
    ctx.font = '10px Inter';
    for (let i = 0; i < 7; i++) {
        const xPos = PADDING + xStep * i;
        ctx.fillText(DAY_NAMES[i], xPos, height - PADDING + 12);
        
        // Vertical Grid Lines
        ctx.beginPath();
        ctx.strokeStyle = '#f0f0f0';
        ctx.moveTo(xPos, height - PADDING);
        ctx.lineTo(xPos, PADDING);
        ctx.stroke();
    }
    
    // Y-Axis Labels (Amount) and Horizontal Grid
    ctx.textAlign = 'right';
    const yTickCount = 4;
    for (let i = 0; i <= yTickCount; i++) {
        const yValue = (maxAmount / yTickCount) * i;
        const yPos = height - PADDING - (plotHeight / yTickCount) * i;

        ctx.beginPath();
        ctx.strokeStyle = '#f0f0f0';
        ctx.moveTo(PADDING, yPos);
        ctx.lineTo(width - PADDING, yPos);
        ctx.stroke();

        ctx.fillStyle = BLACK_COLOR;
        ctx.fillText(`$${yValue.toFixed(0)}`, PADDING - 5, yPos + 4);
    }
    
    // --- Draw Data Points (Scatter) ---
    const pointRadius = 4;

    Object.values(categoryMap).forEach(categoryData => {
        ctx.fillStyle = categoryData.color;
        
        categoryData.data.forEach(point => {
            const xPos = PADDING + xStep * point.x; // Point.x is 0 to 6
            const yPos = height - PADDING - (point.y / maxAmount) * plotHeight;
            
            ctx.beginPath();
            ctx.arc(xPos, yPos, pointRadius, 0, Math.PI * 2);
            ctx.fill();
        });
    });

    // --- Render Legend ---
    legendDiv.innerHTML = sortedCategories.map((category, index) => {
        const color = SCATTER_COLORS[index % SCATTER_COLORS.length];
        return `
            <div class="legend-item">
                <span class="legend-color" style="background-color: ${color};"></span>
                <span>${category}</span>
            </div>
        `;
    }).join('');
}

document.addEventListener("DOMContentLoaded", () => {
    // Attach event listeners for dynamic updates
    document.getElementById("scopeSelect").addEventListener("change", updateScopeVisibility);
    document.getElementById("yearSelect").addEventListener("change", filterAndRender);
    document.getElementById("monthSelect").addEventListener("change", filterAndRender);
    document.getElementById("weekSelect").addEventListener("change", filterAndRender);
    
    initializeFirebaseAndAuth();
});