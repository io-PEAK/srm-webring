// ============================================================
// js/ring.js — SRM WebRing navigation widget
// Runs on member sites: parses #site?nav=prev|next from the hash
// and redirects to the previous/next active member in the ring.
// ============================================================
function handleRingNavigation() {
    const rawHash = window.location.hash.slice(1);

    if (!rawHash) return; // no hash means someone just visited the directory directly
    
    // Parse siteUrl and navigation query parameters
    const [siteUrl, queryString] = rawHash.split('?');
    const params = new URLSearchParams(queryString);
    const direction = params.get('nav');

    // ── Resolve the ring neighbour and redirect ──
    // Fetch members relative to root page containing the widget handler
    fetch('data/members.json')
        .then(response => response.json())
        .then(allMembers => {
            // EXCLUDE hidden / unreachable members from the ring rotation
            const activeMembers = allMembers.filter(m => !m.hidden && !m.unreachableSince);

            if (activeMembers.length === 0) {
                console.error('No active members in the ring rotation.');
                return;
            }

            // Find current site's position in active ring list
            const currentIndex = activeMembers.findIndex(m => m.website.replace(/\/$/, '') === siteUrl.replace(/\/$/, ''));

            if (currentIndex === -1) {
                console.error('Site not found or is currently hidden from active webring:', siteUrl);
                // Redirect back to main directory index so user isn't stranded
                window.location.href = 'index.html';
                return;
            }

            let targetIndex;
            if (direction === 'next') {
                targetIndex = (currentIndex + 1) % activeMembers.length;
            } else if (direction === 'prev') {
                targetIndex = (currentIndex - 1 + activeMembers.length) % activeMembers.length;
            } else {
                // If invalid nav action, redirect to their site
                window.location.href = activeMembers[currentIndex].website;
                return;
            }

            // Perform redirect to next/prev site in loop
            window.location.href = activeMembers[targetIndex].website;
        })
        .catch(err => {
            console.error('Webring navigation failed:', err);
        });
}

// Listen to hash changes (e.g. back buttons or multiple widget clicks)
window.addEventListener('hashchange', handleRingNavigation);

// Run on page load
handleRingNavigation();