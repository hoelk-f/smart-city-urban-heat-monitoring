import requests
import csv
import random
import time

CSV_FILE = '/app/src/assets/sensors.csv'
SPLIT_1_FILE = '/app/src/assets/sensor_1.csv'
SPLIT_2_FILE = '/app/src/assets/sensor_2.csv'
WEATHER_REPORT_FILE = '/app/src/assets/weatherreportapi.csv'
API_KEY = '37e2da2c2917f40932030c5cbab0d188'
WEATHER_UPDATE_INTERVAL = 86400
NOISE_UPDATE_INTERVAL = 5

current_temperature = None
last_weather_update = 0

def get_weather_temperature():
    global current_temperature, last_weather_update
    print("Fetching weather data...")
    api_url = 'http://api.weatherstack.com/current'
    params = {
        'access_key': API_KEY,
        'query': 'Wuppertal',
        'units': 'm'
    }
    
    try:
        response = requests.get(api_url, params=params)
        response.raise_for_status()
        
        print("API Response:", response.json())
        
        data = response.json()
        
        if 'current' in data and 'temperature' in data['current']:
            current_temperature = data['current']['temperature']
            last_weather_update = time.time()
            print(f"Updated temperature from API: {current_temperature}°C")
            log_weather_report(current_temperature)
        else:
            print("Error: Invalid data structure from API")
    except requests.RequestException as e:
        print(f"Error fetching temperature: {e}")

def log_weather_report(temperature):
    """Writes only the latest fetched temperature and timestamp to weatherreportapi.csv."""
    print(f"Logging weather data: {temperature}°C")
    fieldnames = ['timestamp', 'temperature']
    with open(WEATHER_REPORT_FILE, mode='w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        
        # Write the header and the latest data
        writer.writeheader()
        writer.writerow({
            'timestamp': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime()),
            'temperature': temperature
        })

def read_csv(filename):
    print(f"Reading CSV file: {filename}")
    with open(filename, mode='r') as csvfile:
        reader = csv.DictReader(csvfile)
        return list(reader)

def write_csv(filename, data):
    print(f"Writing to CSV file: {filename}")
    fieldnames = ['QUARTIER', 'lat', 'lng', 'temp', 'activated', 'temp_with_noise']
    with open(filename, mode='w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)

def split_csv_data(data):
    mid_index = len(data) // 2
    return data[:mid_index], data[mid_index:]

def update_csv_with_noise():
    global current_temperature
    if current_temperature is not None:
        print(f"Updating CSV with current temperature: {current_temperature}")
        data = read_csv(CSV_FILE)
        for row in data:
            row['temp'] = current_temperature
            noise = random.uniform(-1, 1)
            row['temp_with_noise'] = round(float(current_temperature) + noise, 2)
        write_csv(CSV_FILE, data)

        split1, split2 = split_csv_data(data)
        write_csv(SPLIT_1_FILE, split1)
        write_csv(SPLIT_2_FILE, split2)
    else:
        print("Current temperature is None; skipping CSV update.")

def main():
    global last_weather_update
    print("Starting main loop...")
    get_weather_temperature()
    while True:
        current_time = time.time()
        if current_time - last_weather_update >= WEATHER_UPDATE_INTERVAL:
            get_weather_temperature()

        update_csv_with_noise()
        time.sleep(NOISE_UPDATE_INTERVAL)

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"An unhandled exception occurred: {e}")
        import traceback
        traceback.print_exc()
        while True:
            time.sleep(1)
