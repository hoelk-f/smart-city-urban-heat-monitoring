import requests
import csv
import random
import time
import threading

# The API only retrieves weather data for WUPPERTAL and not any subregions
# It creates a CSV with a mapping for each subregion as basis
CSV_FILE = '/app/src/assets/sensors.csv'
SPLIT_1_FILE = '/app/src/assets/sensor_1.csv'
SPLIT_2_FILE = '/app/src/assets/sensor_2.csv'
API_KEY = 'b46ba223dfe6adc962f8dc2c94ce7f2a'
WEATHER_UPDATE_INTERVAL = 1800  # 30 minutes in seconds
NOISE_UPDATE_INTERVAL = 5  # 5 seconds

# Shared variable for temperature data
current_temperature = None

def get_weather_temperature():
    global current_temperature
    api_url = 'http://api.weatherstack.com/current'
    params = {
        'access_key': API_KEY,
        'query': 'Wuppertal',
        'units': 'm'
    }
    
    try:
        response = requests.get(api_url, params=params)
        response.raise_for_status()  # Raise an error for unsuccessful requests
        data = response.json()
        
        # Check if the temperature data is in the response
        if 'current' in data and 'temperature' in data['current']:
            current_temperature = data['current']['temperature']
            print(f"Updated temperature from API: {current_temperature}°C")
        else:
            print("Error: Invalid data structure from API")
    except requests.RequestException as e:
        print(f"Error fetching temperature: {e}")

def read_csv(filename):
    with open(filename, mode='r') as csvfile:
        reader = csv.DictReader(csvfile)
        return list(reader)

def write_csv(filename, data):
    fieldnames = ['QUARTIER', 'lat', 'lng', 'temp', 'activated', 'temp_with_noise']
    with open(filename, mode='w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for row in data:
            writer.writerow(row)

def split_csv_data(data):
    """Split CSV data into two parts."""
    mid_index = len(data) // 2  # Calculate mid index to split data evenly
    return data[:mid_index], data[mid_index:]

def update_csv_with_noise():
    global current_temperature
    while True:
        # Ensure that we have a valid temperature to work with
        if current_temperature is not None:
            data = read_csv(CSV_FILE)
            for row in data:
                row['temp'] = current_temperature
                # Apply random noise to the temperature
                noise = random.uniform(-1, 1)
                row['temp_with_noise'] = round(float(current_temperature) + noise, 2)
            
            write_csv(CSV_FILE, data)

            split1, split2 = split_csv_data(data)
            write_csv(SPLIT_1_FILE, split1)
            write_csv(SPLIT_2_FILE, split2)
        
        # Wait for the next noise update
        time.sleep(NOISE_UPDATE_INTERVAL)

def weather_update_thread():
    while True:
        get_weather_temperature()
        # Wait for the next weather update
        time.sleep(WEATHER_UPDATE_INTERVAL)

def main():
    # Start the weather update thread
    threading.Thread(target=weather_update_thread, daemon=True).start()
    
    # Start the CSV noise update in the main thread
    update_csv_with_noise()

if __name__ == '__main__':
    main()
