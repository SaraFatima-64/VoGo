from flask import Flask, render_template, request, jsonify
import requests
import re
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

ORS_API_KEY = '5b3ce3597851110001cf6248496f95cfac2646268264cdac1c4556cb'

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/get_directions', methods=['POST'])
def get_directions():
    data = request.json
    origin = data.get('origin', '').strip()
    destination = data.get('destination', '').strip()
    
    # Add Hyderabad context if not already present
    if 'hyderabad' not in origin.lower():
        origin += ", Hyderabad, India"
    if 'hyderabad' not in destination.lower():
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
    """Format the response with accurate API-provided distance and duration"""
    return {
        'origin': origin.split(',')[0].strip(),
        'destination': destination.split(',')[0].strip(),
        'total_distance': format_distance(route_data['summary']['distance']),
        'total_duration': format_duration(route_data['summary']['duration'] / 60),  # Convert seconds to minutes
        'steps': [{
            'step_number': i+1,
            'instruction': clean_instruction(step['instruction']),
            'distance': format_distance(step['distance']),
            'duration': format_duration(step['duration'] / 60)  # Convert seconds to minutes
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
    url = f"https://api.openrouteservice.org/geocode/search?api_key={ORS_API_KEY}&text={location}"
    response = requests.get(url)
    data = response.json()
    
    if not data.get('features'):
        raise ValueError("Location not found")
    
    return {
        'lng': data['features'][0]['geometry']['coordinates'][0],
        'lat': data['features'][0]['geometry']['coordinates'][1]
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