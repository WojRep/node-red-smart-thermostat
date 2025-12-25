# @wrepinski/node-red-smart-thermostat

Wtyczka Node-RED do inteligentnego sterowania termostatami Zigbee 3.0 (głowice grzejnikowe) oraz klimatyzatorami. Wykorzystuje adaptacyjny algorytm PID zapewniający płynną, oszczędzającą baterię regulację temperatury zamiast prostego sterowania ON/OFF.

**[English documentation](README.md)**

## Funkcje

- **Kompatybilność z Home Assistant HVAC** - Tryby `heat`, `cool`, `heat_cool`
- **Precyzja termostatu** - Konfigurowalna rozdzielczość (1°C, 0.5°C, 0.2°C, 0.1°C)
- **Adaptacyjny regulator PID** - Automatycznie uczy się optymalnych parametrów
- **Oszczędność baterii** - Płynne zmiany minimalizują aktywacje silnika zaworu
- **Ograniczenie szybkości zmian** - Zapobiega szybkim zmianom temperatury
- **Histereza** - Martwa strefa zapobiega oscylacjom wokół temperatury docelowej
- **Wyjście aktywnej regulacji** - Trzecie wyjście informuje o aktywnej regulacji
- **Trwały stan** - Nauczone parametry zapisywane do pliku, przetrwają restart Node-RED

## Instalacja

### Przez menedżer palet Node-RED

1. Otwórz Node-RED
2. Przejdź do **Menu -> Manage palette -> Install**
3. Wyszukaj `@wrepinski/node-red-smart-thermostat`
4. Kliknij Install

### Przez npm

```bash
cd ~/.node-red
npm install @wrepinski/node-red-smart-thermostat
```

### Instalacja offline

```bash
cd ~/.node-red
npm install /sciezka/do/wrepinski-node-red-smart-thermostat-2.0.6.tgz
```

## Użycie

### Podstawowa konfiguracja

1. Przeciągnij węzeł **smart thermostat** z palety na flow
2. Wybierz tryb pracy (heat/cool/heat_cool)
3. Ustaw precyzję termostatu (rozdzielczość Twojego urządzenia)
4. Podłącz wyjście czujnika temperatury do wejścia węzła
5. Podłącz wyjście 1 do termostatu Zigbee (ustawienie temperatury)
6. Skonfiguruj temperaturę min/max/docelową

### Przykładowy flow

```
                                        ┌─→ [Termostat Zigbee]
[Czujnik temperatury] → [Smart Thermostat] ─→ [Debug]
                                        └─→ [Wskaźnik aktywności]
```

### Wiadomości wejściowe

| Właściwość | Typ | Opis |
| ---------- | --- | ---- |
| `payload` | number | Aktualny odczyt temperatury (wymagany) |
| `setpoint` | number | Nadpisanie temperatury docelowej (opcjonalne) |
| `mode` | string | Zmiana trybu: `heat`, `cool` lub `heat_cool` (opcjonalne) |

### Wiadomości wyjściowe

**Wyjście 1 - Setpoint temperatury:**

```javascript
{
    payload: 21.5,  // Setpoint do ustawienia na termostacie (zaokrąglony do precyzji)
    topic: "thermostat/setpoint"
}
```

**Wyjście 2 - Debug/Status:**

```javascript
{
    payload: {
        currentTemp: 20.8,        // aktualna temperatura
        targetTemp: 21.0,         // temperatura docelowa
        setpoint: 21.5,           // obliczony setpoint
        error: 0.2,               // błąd (różnica)
        trend: "heating",         // "heating", "cooling", "stable" lub "idle"
        mode: "heat_cool",        // skonfigurowany tryb
        activeMode: "heat",       // aktywny tryb (dla heat_cool)
        precision: 0.5,           // rozdzielczość termostatu
        state: "running",         // "learning" lub "running"
        learningComplete: true,   // czy nauka zakończona
        pid: {
            Kp: 1.2,
            Ki: 0.015,
            Kd: 0.8
        },
        pidTerms: {
            P: 0.24,
            I: 0.08,
            D: -0.02
        }
    }
}
```

**Wyjście 3 - Aktywna regulacja:**

```javascript
{
    payload: true,  // lub false, lub 1/0 zależnie od ustawienia
    topic: "thermostat/active"
}
```

## Konfiguracja

| Parametr | Domyślnie | Opis |
| -------- | --------- | ---- |
| **Mode** | heat | Tryb pracy: `heat`, `cool`, `heat_cool` (kompatybilny z HA HVAC) |
| **Precision** | 0.5°C | Rozdzielczość termostatu: 1, 0.5, 0.2, lub 0.1°C |
| **Target Temp** | 21°C | Domyślna temperatura docelowa |
| **Min Temp** | 15°C | Minimalny dozwolony setpoint |
| **Max Temp** | 25°C | Maksymalny dozwolony setpoint |
| **Hysteresis** | 0.2°C | Martwa strefa zapobiegająca oscylacjom |
| **Max Change** | 0.5°C/cykl | Maksymalna zmiana temperatury na aktualizację |
| **Sample Interval** | 60s | Oczekiwany czas między odczytami temperatury |
| **Auto-tuning** | Włączony | Adaptacyjne uczenie parametrów PID |
| **Active Output** | Boolean | Format wyjścia 3: Boolean (true/false) lub Number (1/0) |

## Tryby pracy (kompatybilne z Home Assistant HVAC)

### heat

Dla głowic grzejnikowych i systemów grzewczych. Gdy pomieszczenie jest zimne (poniżej celu), setpoint jest ustawiany **powyżej celu** o co najmniej jeden krok precyzji, aby wywołać grzanie.

### cool

Dla klimatyzatorów i systemów chłodzenia. Gdy pomieszczenie jest gorące (powyżej celu), setpoint jest ustawiany **poniżej celu** o co najmniej jeden krok precyzji, aby wywołać chłodzenie.

### heat_cool

Automatycznie przełącza między heat a cool w zależności od aktualnego błędu temperatury. Przydatny dla pomp ciepła lub budynków z grzaniem i chłodzeniem.

## Jak to działa

### Obliczanie setpoint z uwzględnieniem precyzji

Regulator respektuje ustawioną precyzję termostatu:

- **Przy aktywnym grzaniu**: setpoint = cel + (co najmniej jeden krok precyzji)
- **Przy aktywnym chłodzeniu**: setpoint = cel - (co najmniej jeden krok precyzji)
- **Przy stabilizacji**: setpoint = cel (zaokrąglony do precyzji)

Przykład z precyzją = 0.5°C:

```
Cel: 21.0°C
Temp. pokoju: 20.5°C (potrzebne grzanie)
Setpoint: 21.5°C (cel + minimum 0.5°C)

Temp. pokoju: 20.9°C (w histerezie)
Setpoint: 21.0°C (stabilny, równy celowi)
```

### Algorytm adaptacyjny

Regulator wykorzystuje adaptacyjny algorytm PID (proporcjonalno-całkująco-różniczkujący):

1. **Faza nauki** (pierwsze ~1 godzina):
   - Obserwuje jak temperatura pomieszczenia reaguje na zmiany nastawy
   - Szacuje stałą czasową termiczną pomieszczenia
   - Oblicza optymalne parametry PID metodą Cohen-Coon

2. **Faza pracy**:
   - Stosuje sterowanie PID z nauczonymi parametrami
   - Ciągle dostosowuje parametry na podstawie wydajności
   - Wykrywa i reaguje na trendy temperatury

### Oszczędność baterii

Tradycyjne termostaty ON/OFF powodują częste aktywacje silnika zaworu, co szybko wyczerpuje baterie. Ten węzeł:

- **Ogranicza szybkość zmian** - Maksymalnie 0.5°C zmiany na cykl
- **Używa histerezy** - Brak regulacji w martwej strefie
- **Płynne przejścia** - Stopniowe zmiany nastawy zamiast skokowych

## Integracja z Home Assistant

### Użycie node-red-contrib-home-assistant-websocket

Aby wysłać obliczony setpoint do encji climate w Home Assistant, użyj węzła **Call Service** (action) z `node-red-contrib-home-assistant-websocket`.

**Konfiguracja:**

1. Podłącz pierwsze wyjście Smart Thermostat do węzła HA action
2. Skonfiguruj węzeł action:
   - **Action**: `climate.set_temperature`
   - **Target**: Wybierz swoje urządzenie climate (np. `climate.termostat_salon`)
   - **Data** (ustaw typ na `J:` JSONata):
     ```
     {"temperature": $.payload}
     ```

**Przykładowy flow:**

```
[Czujnik temperatury] → [Smart Thermostat] → [HA: climate.set_temperature]
```

**Wyrażenia JSONata dla różnych scenariuszy:**

Podstawowe ustawienie temperatury:

```jsonata
{"temperature": $.payload}
```

Z jawnym trybem HVAC:

```jsonata
{"temperature": $.payload, "hvac_mode": "heat"}
```

Dla trybu heat_cool z zakresem temperatur (używając danych debug z drugiego wyjścia):

```jsonata
{
  "target_temp_high": $.payload.targetTemp + 1,
  "target_temp_low": $.payload.targetTemp - 1,
  "hvac_mode": "heat_cool"
}
```

**Dostępne parametry climate.set_temperature:**

| Parametr | Typ | Opis |
| -------- | --- | ---- |
| `temperature` | number | Temperatura docelowa (dla trybu heat lub cool) |
| `target_temp_high` | number | Górna granica (dla trybu heat_cool) |
| `target_temp_low` | number | Dolna granica (dla trybu heat_cool) |
| `hvac_mode` | string | `heat`, `cool`, `heat_cool`, `off`, `auto` |

### Bezpośrednie publikowanie MQTT (Zigbee2MQTT)

Do bezpośredniego sterowania przez MQTT (np. Zigbee2MQTT), użyj węzła **mqtt out**.

**Konfiguracja:**

1. Podłącz pierwsze wyjście Smart Thermostat do węzła **mqtt out**
2. Skonfiguruj węzeł mqtt out:
   - **Topic**: `zigbee2mqtt/NAZWA_TWOJEGO_URZADZENIA/set`
   - **QoS**: 1

3. Dodaj węzeł **change** między nimi do formatowania payload:
   - Ustaw `msg.payload` na wyrażenie JSONata:
     ```jsonata
     {"current_heating_setpoint": $.payload}
     ```

**Przykładowy flow:**

```
[Czujnik temperatury] → [Smart Thermostat] → [Change Node] → [MQTT Out]
```

**Alternatywnie: Użycie węzła function:**

```javascript
msg.payload = {
    current_heating_setpoint: msg.payload
};
return msg;
```

**Typowe właściwości termostatów Zigbee2MQTT:**

| Właściwość | Opis |
| ---------- | ---- |
| `current_heating_setpoint` | Temperatura docelowa dla grzania |
| `occupied_heating_setpoint` | Setpoint gdy zajęte |
| `system_mode` | `off`, `heat`, `cool`, `auto` |
| `running_state` | Aktualny stan pracy |

> **Uwaga:** Nazwy właściwości różnią się w zależności od urządzenia. Sprawdź stronę "exposes" Twojego urządzenia w Zigbee2MQTT.

## Dynamiczne sterowanie

Możesz zmieniać ustawienia dynamicznie wysyłając wiadomości:

```javascript
// Zmiana temperatury docelowej
msg.setpoint = 22.5;
msg.payload = 20.1;  // Aktualny odczyt temperatury
return msg;

// Zmiana trybu pracy (kompatybilny z HA HVAC)
msg.mode = "cool";
msg.payload = 24.5;
return msg;
```

Przydatne do:

- Harmonogramów czasowych
- Wykrywania obecności
- Zmiany trybu sezonowego
- Trybów oszczędzania energii

## Wyjście aktywnej regulacji

Trzecie wyjście informuje, czy termostat aktywnie pracuje nad osiągnięciem temperatury docelowej:

- **true/1** - Aktywnie grzeje lub chłodzi w kierunku celu
- **false/0** - Bezczynny (cel osiągnięty, w histerezie, lub zły tryb dla aktualnych warunków)

Zastosowania:

- Sterowanie pompami obiegowymi
- Powiadomienia
- Monitoring energii
- Wyświetlanie statusu na dashboardach

## Trwałe przechowywanie

Nauczone parametry PID są automatycznie zapisywane do plików i przywracane po restarcie Node-RED.

**Lokalizacja:** `~/.node-red/.smart-thermostat/state-<node-id>.json`

**Co jest zapisywane:**

- Parametry PID (Kp, Ki, Kd)
- Stan i postęp nauki
- Historia temperatury do adaptacji
- Aktualny tryb pracy

**Kiedy zapisywany jest stan:**

- Gdy zmienią się parametry PID (po zakończeniu nauki)
- Gdy ciągła adaptacja dostosuje parametry
- Przy zamknięciu/restarcie węzła

## Resetowanie nauczonych parametrów

Jeśli regulator zachowuje się nieoczekiwanie lub zmienił się system grzewczy/chłodniczy:

1. Otwórz konfigurację węzła w edytorze Node-RED
2. Kliknij przycisk **Reset Learned Parameters**
3. Wdróż flow (Deploy)
4. Regulator rozpocznie fazę nauki od nowa

To usuwa plik stanu i resetuje wszystkie nauczone parametry.

## Rozwiązywanie problemów

### Wyjście oscyluje szybko

- Zwiększ wartość **Hysteresis** (spróbuj 0.3-0.5°C)
- Zmniejsz **Max Change** aby ograniczyć szybkość zmian

### Odpowiedź jest zbyt wolna

- Wyłącz **Auto-tuning** i ręcznie ustaw parametry PID
- Zmniejsz wartość **Hysteresis**

### Temperatura przekracza cel

- Poczekaj na zakończenie fazy nauki (minimum 1 godzina)
- Jeśli problem się powtarza, zresetuj i spróbuj ponownie ze stabilniejszymi danymi wejściowymi

### Tryb się nie zmienia

- Upewnij się, że wysyłasz `msg.mode` razem z odczytem temperatury
- Prawidłowe wartości: `heat`, `cool`, `heat_cool` (wielkość liter nie ma znaczenia)
- Akceptowane są też stare nazwy: `heating`, `cooling`, `auto`

## Historia zmian

### v2.0.8

- **Poprawiono wyjście Active (Wyjście 3)** - Ulepszona logika sygnału aktywacji grzania/chłodzenia
- Teraz poprawnie wskazuje kiedy kocioł/klimatyzator powinien być aktywny
- Zaimplementowano histerezę z "zatrzaskiem" - zapobiega szybkim cyklom włącz/wyłącz
- Wyjście aktywne teraz prawidłowo śledzi stan osiągnięcia celu

### v2.0.7

- Poprawiono metadane pakietu npm (URL repozytorium)
- Poprawiono nazwę pakietu w instrukcjach instalacji

### v2.0.6

- **Migracja repozytorium** - Przeniesiono do nowego repozytorium: node-red-smart-thermostat
- Zaktualizowano wszystkie URL-e i odniesienia

### v2.0.0

- **Harmonogram tygodniowy** - Elastyczne przedziały czasowe dla każdego dnia tygodnia
- **Tryb Boost** - Tymczasowe nadpisanie temperatury z minutnikiem
- **Tryb Away** - Ograniczenie temperatury gdy nieobecny
- **MQTT Discovery** - Automatyczne tworzenie encji climate w Home Assistant
- **Tryby operacyjne** - Przełączanie między manual, schedule i off
- **Rozszerzony status** - Status węzła pokazuje timer boost, tryb away, informacje o harmonogramie
- **Tryby preset** - Presety Home Assistant: away, boost
- Nowe właściwości wejściowe: `msg.schedule`, `msg.boost`, `msg.away`, `msg.operatingMode`
- Rozszerzony debug output z informacjami o harmonogramie/boost/away

### v1.4.1

- Dodano dokumentację integracji z Home Assistant (przykłady JSONata)
- Dodano przykłady publikowania Zigbee2MQTT / MQTT
- Ulepszenia dokumentacji

### v1.4.0

- **Breaking**: Zmiana nazw trybów na format Home Assistant HVAC (`heat`, `cool`, `heat_cool`)
- Dodano ustawienie precyzji termostatu (1°C, 0.5°C, 0.2°C, 0.1°C)
- Zmieniono nazwę `output` na `setpoint` w debug output dla jasności
- Setpoint gwarantuje teraz minimum jeden krok powyżej/poniżej celu przy aktywnej regulacji
- Setpoint równy celowi gdy stabilny (w histerezie)
- Stare nazwy trybów (`heating`, `cooling`, `auto`) nadal akceptowane dla wstecznej kompatybilności

### v1.3.0

- Dodano trwałe przechowywanie nauczonych parametrów w pliku
- Stan przetrwa restart Node-RED
- Automatyczna migracja z context storage
- Inteligentny zapis: tylko gdy parametry PID rzeczywiście się zmienią

### v1.2.0

- Dodano obsługę trybu chłodzenia
- Dodano tryb automatyczny (automatyczne przełączanie grzanie/chłodzenie)
- Dodano trzecie wyjście dla statusu aktywnej regulacji
- Dodano wybór formatu wyjścia (boolean/number)
- Zaktualizowano dokumentację

### v1.1.0

- Dodano tryb chłodzenia
- Dodano wybór trybu w UI

### v1.0.0

- Pierwsze wydanie z obsługą grzania

## Licencja

Licencja MIT - szczegóły w pliku [LICENSE](LICENSE).

## Współtworzenie

Zapraszamy do współtworzenia! Otwórz issue lub prześlij pull request na [GitHub](https://github.com/WojRep/node-red-smart-thermostat).
