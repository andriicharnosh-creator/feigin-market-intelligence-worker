# Standard FEIGIN: Git i dowody wydania

## Cel
Każda zmiana w kodzie ma być możliwa do prześledzenia od commita do działającego wydania. Ten standard dotyczy aplikacji, usług, dashboardów, workerów i narzędzi wewnętrznych FEIGIN.

## Przepływ pracy
1. Zaktualizuj gałąź bazową i utwórz gałąź roboczą: `git switch -c feat/nazwa`, `fix/nazwa` albo `docs/nazwa`.
2. Przed stagingiem sprawdź zakres: `git status --short`, `git diff`. Dodaj tylko zamierzone pliki: `git add <ścieżka>`; sprawdź `git diff --cached`. Po kolejnej edycji dodaj plik ponownie.
3. Zapisz logicznie spójny commit. Zapisz pełny SHA commita, którego dotyczy CI i przegląd.
4. Otwórz Pull Request do gałęzi bazowej. Bezpośrednie commity do `main` nie są standardową ścieżką. Wymagany jest przegląd zmian oraz zielone, właściwe dla projektu kontrole CI.
5. Po scaleniu wdroż projekt zgodnie z jego istniejącą ścieżką wydania. Nie utożsamiaj merge z wdrożeniem.
6. Dla wdrożeń produkcyjnych wykonaj runtime readback: potwierdź działający URL/usługę, podstawowy przepływ oraz, gdzie dotyczy, autoryzację i izolację tenantów. Zapisz środowisko, czas, URL, identyfikator wdrożenia i SHA lub udokumentowane mapowanie wdrożenia na SHA.
7. Niezależny Verifier sprawdza artefakt, CI i runtime readback. Dopiero wtedy zamknij zmianę jako zweryfikowaną.

## Zasady dowodowe
- CI musi dotyczyć dokładnie SHA kandydującego do merge. Wynik dla innego commita nie jest dowodem.
- Wdrożenie i runtime readback muszą wskazywać ten sam SHA lub wiarygodne, zapisane mapowanie artefaktu na SHA.
- Brak dostępu, brak danych, rozbieżny SHA lub niezgodność weryfikatorów oznacza `HOLD`.
- Projekty nieprodukcyjne i zmiany wyłącznie dokumentacyjne mogą oznaczyć wdrożenie/runtime jako `N/A`, ale muszą podać powód. Nie oznaczaj wyniku CI ani weryfikacji jako PASS bez dowodu.
- Test składni lub kompilacji jest kontrolą bazową, nie zastępuje testów zachowania biznesowego.
- `git pull` pobiera zmiany i integruje je z bieżącą gałęzią; może użyć merge albo rebase, zależnie od konfiguracji.

## Ochrona gałęzi
W ustawieniach repozytorium należy wymagać PR, właściwych status checks i zatwierdzenia przez uprawnionego recenzenta, z ograniczonym bypass. Sam szablon PR ani istnienie workflow nie wymuszają tych reguł. Utrzymuj listę wymaganych checks zgodną z aktywnymi workflowami danego projektu.
