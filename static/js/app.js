document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const statusDiv = document.getElementById('status');
    const originDiv = document.getElementById('origin');
    const destinationDiv = document.getElementById('destination');
    const directionsDiv = document.getElementById('directions');
    const stepsList = document.getElementById('steps');
    const summaryDiv = document.getElementById('summary');
    
    // App State
    let origin = '';
    let destination = '';
    let directionsData = null;
    let speechSynthesis = window.speechSynthesis;
    let recognition;
    let isSpeaking = false;
    let isSpacePressed = false;
    let isSettingLocation = false;
    let isDirectionsActive = false;
    
    // Directions state
    let currentStepIndex = 0;
    let directionsQueue = [];
    let currentUtterance = null;
    let isPaused = false;
    let pauseResumeTimeout = null;

    // Initialize speech synthesis and recognition
    function initSpeech() {
        if (!statusDiv) {
            console.error('Status div not found');
            return false;
        }
        
        if (!('speechSynthesis' in window)) {
            statusDiv.textContent = 'Speech synthesis not supported';
            return false;
        }
        
        if (!('webkitSpeechRecognition' in window)) {
            statusDiv.textContent = 'Speech recognition not supported';
            return false;
        }
        
        recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        
        recognition.onresult = handleSpeechResult;
        recognition.onerror = handleSpeechError;
        recognition.onend = handleSpeechEnd;
        
        return true;
    }
    
    // Handle spacebar press
    document.addEventListener('keydown', function(e) {
        if (e.code === 'Space' && !isSpacePressed) {
            e.preventDefault();
            isSpacePressed = true;
            
            if (isDirectionsActive) {
                // Directions mode - toggle pause/resume
                e.preventDefault();
                togglePauseResume();
            } else {
                // Start recording full prompt
                statusDiv.textContent = 'Recording your navigation prompt...';
                speakMessage("Please say your navigation prompt, for example, navigate from your current location to your destination.", false);
                recognition.start();
            }
        }
    });
    
    document.addEventListener('keyup', function(e) {
        if (e.code === 'Space' && isSpacePressed) {
            e.preventDefault();
            isSpacePressed = false;
            if (!isDirectionsActive) {
                recognition.stop();
            }
        }
    });
    
    function togglePauseResume() {
        if (isPaused) {
            // Resume speaking
            isPaused = false;
            statusDiv.textContent = 'Resuming directions...';
            speakMessage("Resuming directions", false);
            
            // Clear any existing timeout
            if (pauseResumeTimeout) {
                clearTimeout(pauseResumeTimeout);
            }
            
            // Continue with directions after a brief delay
            pauseResumeTimeout = setTimeout(() => {
                speakDirections();
            }, 800);
        } else {
            // Pause speaking
            isPaused = true;
            statusDiv.textContent = 'Directions paused. Press space to resume.';
            speakMessage("Directions paused", false);
            speechSynthesis.cancel();
            isSpeaking = false;
            // Also stop current utterance to prevent overlap
            if (currentUtterance) {
                currentUtterance.onend = null;
                // Cancel current utterance speaking if possible
                if (speechSynthesis.speaking) {
                    speechSynthesis.cancel();
                }
            }
        }
    }
    
    // Handle speech recognition results
    function handleSpeechResult(event) {
        const transcript = event.results[0][0].transcript.trim();
        showVoiceFeedback(transcript);

        // Send the full transcript as a single prompt to backend
        originDiv.textContent = 'Processing prompt...';
        destinationDiv.textContent = '';
        statusDiv.textContent = 'Processing your request...';

        fetch('/get_directions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: transcript
            })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { 
                    throw new Error(err.error || 'Failed to get directions');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }

            originDiv.textContent = data.origin;
            destinationDiv.textContent = data.destination;
            statusDiv.textContent = 'Directions ready.';
            directionsData = data;
            displayDirections(data);
            directionsDiv.classList.remove('hidden');
            prepareDirections();
            isDirectionsActive = true;  // Set directions active here
            speakDirections();
        })
        .catch(error => {
            console.error('Direction fetch error:', error);
            statusDiv.textContent = 'Error getting directions';
            speakMessage("Sorry, I couldn't get directions. Please try again.", false);
            isDirectionsActive = false;
        });
    }
    
    function handleSpeechError(event) {
        console.error('Speech recognition error:', event.error);
        statusDiv.textContent = 'Error in voice recognition. Please try again.';
        speakMessage("Sorry, I didn't catch that. Please try again.", false);
    }
    
    function handleSpeechEnd() {
        // Auto-restart not needed with push-to-talk
    }
    
    // Speech functions
    function speakMessage(message, listenAfter) {
        stopSpeaking();
        
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.onend = function() {
            isSpeaking = false;
            if (listenAfter) {
                recognition.start();
            }
        };
        
        speechSynthesis.speak(utterance);
        isSpeaking = true;
        currentUtterance = utterance;
    }
    
    function prepareDirections() {
        if (!directionsData) return;
        
        directionsQueue = [];
        
        // Add introduction with accurate duration
        directionsQueue.push({
            text: `Directions from ${directionsData.origin} to ${directionsData.destination}. ` +
                  `Total distance is ${directionsData.total_distance}. ` +
                  `Expected travel time is about ${directionsData.total_duration}. ` +
                  `Starting directions now.`,
            isIntro: true
        });
        
        // Process each step (just instructions)
        directionsData.steps.forEach(step => {
            let instruction = step.instruction;
            
            // Clean up instruction text
            instruction = instruction.replace(/^Head /, 'Go ')
                                   .replace(/^Turn slight /, 'Turn slightly ')
                                   .replace(/^Continue straight /, 'Continue on ')
                                   .replace(/Destination will be/, 'Your destination will be');
            
            directionsQueue.push({
                text: instruction,
                isIntro: false
            });
        });
        
        directionsQueue.push({
            text: "You have arrived at your destination.",
            isIntro: false
        });
        
        currentStepIndex = 0;
        isPaused = false;
    }
    
    function speakDirections() {
        if (isPaused || currentStepIndex >= directionsQueue.length) {
            isSpeaking = false;
            if (currentStepIndex >= directionsQueue.length) {
                isDirectionsActive = false;
            }
            return;
        }
        
        const currentItem = directionsQueue[currentStepIndex];
        const utterance = new SpeechSynthesisUtterance(currentItem.text);
        
        utterance.onend = () => {
            isSpeaking = false;
            if (!isPaused) {
                currentStepIndex++;
                if (currentStepIndex < directionsQueue.length) {
                    // Small delay between instructions
                    setTimeout(speakDirections, 800);
                } else {
                    isDirectionsActive = false;
                }
            }
        };
        
        utterance.onerror = (event) => {
            console.error('SpeechSynthesis error:', event);
            isSpeaking = false;
        };
        
        stopSpeaking();
        speechSynthesis.speak(utterance);
        isSpeaking = true;
        currentUtterance = utterance;
    }
    
    function stopSpeaking() {
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
        }
        isSpeaking = false;
        currentUtterance = null;
    }
    
    // UI Feedback
    function showVoiceFeedback(text) {
        const feedback = document.createElement('div');
        feedback.className = 'voice-feedback show';
        feedback.textContent = `Heard: ${text}`;
        document.body.appendChild(feedback);
        
        setTimeout(() => {
            feedback.classList.remove('show');
            setTimeout(() => feedback.remove(), 300);
        }, 1500);
    }
    
    // Directions fetching
    function fetchDirections(origin, destination) {
        statusDiv.textContent = 'Getting directions...';
        
        fetch('/get_directions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                origin: origin,
                destination: destination
            })
        })
        .then(response => {
            if (!response.ok) {
                return response.json().then(err => { 
                    throw new Error(err.error || 'Failed to get directions');
                });
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                throw new Error(data.error);
            }
            
            directionsData = data;
            displayDirections(data);
            directionsDiv.classList.remove('hidden');
            prepareDirections();
            speakDirections();
        })
        .catch(error => {
            console.error('Direction fetch error:', error);
            statusDiv.textContent = 'Error getting directions';
            
            let errorMsg = "Sorry, I couldn't get directions. ";
            if (error.message.includes('Location not found')) {
                errorMsg += "Please check the location names and try again.";
            } else if (error.message.includes('API Error')) {
                errorMsg += "The mapping service is currently unavailable.";
            } else {
                errorMsg += "Please try again later.";
            }
            
            speakMessage(errorMsg, false);
            isDirectionsActive = false;
        });
    }
    
    function displayDirections(data) {
        if (!summaryDiv || !stepsList) return;
        
        summaryDiv.innerHTML = `
            <p><strong>From:</strong> ${data.origin}</p>
            <p><strong>To:</strong> ${data.destination}</p>
            <p><strong>Distance:</strong> ${data.total_distance}</p>
            <p><strong>Duration:</strong> ${data.total_duration}</p>
        `;
        
        stepsList.innerHTML = '';
        data.steps.forEach(step => {
            const li = document.createElement('li');
            li.innerHTML = `
                <p><strong>Step ${step.step_number}:</strong> ${step.instruction}</p>
            `;
            stepsList.appendChild(li);
        });
    }
    
    // Initialize the app
    if (initSpeech()) {
        statusDiv.textContent = 'Press and hold Space and speak your navigation prompt';
        speakMessage("Welcome to Voice Navigation. Press and hold the spacebar and speak your navigation prompt.", false);
    }
});