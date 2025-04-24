from flask import Flask, render_template, request, jsonify
import requests
import re
from flask_cors import CORS
import spacy

app = Flask(__name__)
CORS(app)

ORS_API_KEY = '5b3ce3597851110001cf6248496f95cfac2646268264cdac1c4556cb'

# Load spaCy English model
nlp = spacy.load("en_core_web_sm")

@app.route('/')
def index():
    return render_template('index.html')

def extract_locations(prompt):
    """
    Use spaCy NLP to extract origin and destination locations from the prompt.
    This is a heuristic approach looking for GPE (Geo-Political Entities).
    If not found, try regex patterns for common phrases.
    """
    doc = nlp(prompt)
    locations = [ent.text for ent in doc.ents if ent.label_ == "GPE"]
    if len(locations) >= 2:
        return locations[0], locations[1]
    else:
        # Try multiple regex patterns for "from X to Y" or "to Y from X"
        patterns = [
            r'from (.+?) to (.+)',
            r'to (.+?) from (.+)',
            r'navigate (?:from )?(.+?) to (.+)',
            r'go (?:from )?(.+?) to (.+)',
            r'directions (?:from )?(.+?) to (.+)',
            r'(.+?) to (.+)'
        ]
        for pattern in patterns:
            match = re.search(pattern, prompt, re.IGNORECASE)
            if match:
                # Depending on pattern, group order may vary
                if 'to' in pattern and pattern.index('to') < pattern.index('from') if 'from' in pattern else True:
                    return match.group(1).strip(), match.group(2).strip()
                else:
                    return match.group(2).strip(), match.group(1).strip()
    return None, None

@app.route('/get_directions', methods=['POST'])
def get_directions():
    data = request.json
    prompt = data.get('prompt', '').strip()
    
    origin, destination = extract_locations(prompt)
    if not origin or not destination:
        return jsonify({
            'error': 'Could not extract origin and destination from prompt',
            'details': 'Please say something like "Navigate from X to Y"'
        }), 400
    
    # Add Hyderabad context if not already present
    if 'hyderabad' not in origin.lower() and 'india' not in origin.lower():
        origin += ", Hyderabad, India"
    if 'hyderabad' not in destination.lower() and 'india' not in destination.lower():
        destination += ", Hyderabad, India"
    
    try:
        origin_coords = geocode_location(origin)
        dest_coords = geocode_location(destination)
        route_data = get_basic_route(origin_coords, dest_coords)
        response = format_route_response(origin, destination, route_data)
        return jsonify(response)
        
    except Exception as e:
        print(f"Error getting directions: {str(e)}")
        return jsonify({
            'error': 'Could not calculate directions',
            'details': str(e)
        }), 500

def get_basic_route(origin, destination):
    """Get raw route data from API using driving-car profile"""
    url = "https://api.openrouteservice.org/v2/directions/driving-car"
    headers = {'Authorization': ORS_API_KEY}
    
    body = {
        "coordinates": [
            [origin['lng'], origin['lat']],
            [destination['lng'], destination['lat']]
        ],
        "instructions": "true",
        "geometry": "true"
    }
    
    response = requests.post(url, json=body, headers=headers)
    if response.status_code != 200:
        error = response.json().get('error', {}).get('message', 'Unknown error')
        raise ValueError(f"API Error: {error}")
    
    return response.json()['routes'][0]

def format_route_response(origin, destination, route_data):
    """Format the response with accurate duration"""
    duration_min = route_data['summary']['duration'] / 60  # Convert seconds to minutes
    
    return {
        'origin': origin.split(',')[0].strip(),
        'destination': destination.split(',')[0].strip(),
        'total_distance': format_distance(route_data['summary']['distance']),
        'total_duration': format_duration(duration_min),
        'steps': [{
            'step_number': i+1,
            'instruction': clean_instruction(step['instruction']),
            'distance': format_distance(step['distance'])
        } for i, step in enumerate(route_data['segments'][0]['steps'])]
    }

def format_distance(meters):
    """Format distance appropriately for driving"""
    if meters < 1000:
        return f"{meters:.0f} meters"
    km = meters / 1000
    return f"{km:.1f} km" if km < 10 else f"{km:.0f} km"

def format_duration(minutes):
    """Format duration with realistic rounding for driving"""
    if minutes < 1:
        return "less than a minute"
    elif minutes < 60:
        return f"{round(minutes)} minutes"
    else:
        hours = minutes // 60
        mins = round(minutes % 60)
        if mins == 0:
            return f"{hours} hour{'s' if hours > 1 else ''}"
        return f"{hours} hour{'s' if hours > 1 else ''} {mins} minute{'s' if mins != 1 else ''}"

def geocode_location(location):
    """Geocoding with Hyderabad context"""
    url = f"https://api.openrouteservice.org/geocode/search?api_key={ORS_API_KEY}&text={location}&boundary.country=IN"
    response = requests.get(url)
    data = response.json()
    
    if not data.get('features'):
        raise ValueError("Location not found")
    
    # Find the most relevant result (highest confidence)
    best_result = max(data['features'], key=lambda x: x['properties']['confidence'])
    
    return {
        'lng': best_result['geometry']['coordinates'][0],
        'lat': best_result['geometry']['coordinates'][1]
    }

def clean_instruction(instruction):
    """Instruction cleaning for driving"""
    instruction = re.sub(r'<[^>]+>', '', instruction)
    replacements = {
        'Continue onto': 'Continue on',
        'Turn slight': 'Turn slightly',
        'Destination will be': 'Your destination will be',
        'Head ': 'Drive ',
        'left-hand': 'left',
        'right-hand': 'right',
        'Walk ': 'Drive '
    }
    for old, new in replacements.items():
        instruction = instruction.replace(old, new)
    return instruction

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
    
