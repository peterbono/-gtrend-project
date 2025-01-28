import warnings
from pytrends.request import TrendReq
import json
import time
import logging

# Configurer les logs
logging.basicConfig(
    filename="script_logs.txt",
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)

# Ignorer les avertissements de type FutureWarning
warnings.simplefilter(action="ignore", category=FutureWarning)

# Charger les données des modèles
file_path = "bikez_part_1.json"
with open(file_path, "r") as file:
    models = json.load(file)

# Initialiser pytrends
pytrends = TrendReq(hl="fr-FR", tz=360)

# Pondérations pour les régions françaises
region_weights = {
    "Île-de-France": 0.30,
    "Provence-Alpes-Côte d'Azur": 0.20,
    "Occitanie": 0.15,
    "Auvergne-Rhône-Alpes": 0.12,
    "Nouvelle-Aquitaine": 0.08,
    "Bretagne": 0.08,
    "Hauts-de-France": 0.07
}

# Charger les checkpoints s'ils existent
def load_checkpoint():
    try:
        with open("checkpoint.json", "r") as checkpoint_file:
            return json.load(checkpoint_file)
    except FileNotFoundError:
        return {"processed_models": [], "failed_models": []}

# Sauvegarder le checkpoint
def save_checkpoint(processed_models, failed_models):
    with open("checkpoint.json", "w") as checkpoint_file:
        json.dump({"processed_models": processed_models, "failed_models": failed_models}, checkpoint_file, indent=4)
    logging.info("Checkpoint sauvegardé.")

# Fonction pour récupérer les tendances Google
def fetch_trends(model, max_retries=3):
    query = f"{model['Brand']} {model['Model']} motorcycle"
    for attempt in range(max_retries):
        try:
            pytrends.build_payload([query], timeframe="today 12-m", geo="FR")
            data = pytrends.interest_over_time()
            if not data.empty:
                avg_popularity = data[query].mean()
                logging.info(f"Succès: {query} - Popularité moyenne: {avg_popularity}")
                return avg_popularity
            else:
                logging.warning(f"Aucun résultat pour: {query}")
                return 0  # Aucun résultat trouvé
        except Exception as e:
            logging.error(f"Erreur pour {query}, tentative {attempt + 1}/{max_retries}: {e}")
            time.sleep(60)  # Attendre avant de réessayer
    logging.warning(f"Échec après {max_retries} tentatives pour: {query}")
    return None

# Calcul des popularités régionales
def calculate_regional_popularity(national_popularity):
    if national_popularity is None:
        return None  # Aucune donnée disponible
    return {
        region: round(national_popularity * weight, 2)
        for region, weight in region_weights.items()
    }

# Sauvegarder les résultats
def save_results(data, file_name):
    with open(file_name, "w") as file:
        json.dump(data, file, indent=4)
    logging.info(f"Données sauvegardées dans {file_name}")

# Exécuter le traitement
def main():
    # Charger le checkpoint
    checkpoint = load_checkpoint()
    processed_models = checkpoint["processed_models"]
    failed_models = checkpoint["failed_models"]

    # Filtrer les modèles restants à traiter
    remaining_models = [model for model in models if model not in processed_models]

    successful_results = []
    for model in remaining_models:
        popularity = fetch_trends(model)
        if popularity is not None:
            regional_popularity = calculate_regional_popularity(popularity)
            result = {
                "Brand": model["Brand"],
                "Model": model["Model"],
                "Popularity_France": popularity,
                "Popularity_by_region": regional_popularity
            }
            successful_results.append(result)
            processed_models.append(model)
        else:
            failed_models.append(model)

        # Sauvegarder la progression après chaque modèle
        save_results(successful_results, "successful_results.json")
        save_results(failed_models, "failed_models.json")
        save_checkpoint(processed_models, failed_models)

    logging.info("Traitement terminé.")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logging.error(f"Erreur fatale: {e}")
    finally:
        logging.info("Script terminé.")