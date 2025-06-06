import pandas as pd

def leer_excel(path):
    try:
        df = pd.read_excel(path)
        print(df.head())
    except Exception as e:
        print(f"Error al leer el archivo: {e}")