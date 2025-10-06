// profile.js

// Function to display user details retrieved from local storage
function displayUserDetails() {
    const profileDetailsDiv = document.getElementById('profileDetails');
    const userData = localStorage.getItem('currentUser');

    if (!userData) {
        profileDetailsDiv.innerHTML = `
            <p class="profile-error">
                User data not found in local storage. Please log in again.
            </p>
        `;
        // In a real app, this would redirect to login.
        return;
    }

    try {
        const user = JSON.parse(userData);

        // Display the details, omitting the sensitive PIN
        profileDetailsDiv.innerHTML = `
            <div class="profile-detail">
                <label>Full Name</label>
                <p>${user.name || 'N/A'}</p>
            </div>
            <div class="profile-detail">
                <label>Phone Number</label>
                <p>${user.phone || 'N/A'}</p>
            </div>
            <div class="profile-detail">
                <label>Bank Account Number</label>
                <p>${user.bank || 'N/A'}</p>
            </div>
            <div class="profile-detail">
                <label>User PIN (Omitted)</label>
                <p>********</p>
            </div>
        `;
    } catch (error) {
        profileDetailsDiv.innerHTML = `<p class="profile-error">Error parsing user data.</p>`;
        console.error("Error parsing user data from local storage:", error);
    }
}

document.addEventListener('DOMContentLoaded', displayUserDetails);