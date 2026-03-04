# Install
BIN = kronik
BUILD_DIR = build
BIN_PATH = $(BUILD_DIR)/$(BIN)

# Flags
CFLAGS += -g -std=c89 -Wall -Wextra -pedantic
CPPFLAGS += -MMD -MP

# Set STATIC_GLEW=1 to avoid a runtime libGLEW.so.* dependency.
ifeq ($(STATIC_GLEW),1)
	GLEW_LIB = -Wl,-Bstatic -lGLEW -Wl,-Bdynamic
else
	GLEW_LIB = -lGLEW
endif

SRC = main.c nuklear_impl.c
OBJ = $(SRC:%.c=$(BUILD_DIR)/%.o)
DEP = $(OBJ:.o=.d)

ifeq ($(OS),Windows_NT)
BIN := $(BIN).exe
LIBS = -lglfw3 -lopengl32 -lm -lGLEW32
else
	UNAME_S := $(shell uname -s)
	ifeq ($(UNAME_S),Darwin)
		LIBS := -lglfw -framework OpenGL -framework Cocoa -framework IOKit -framework CoreVideo -lm $(GLEW_LIB) -L/usr/local/lib
	else
		LIBS = -lglfw -lGL -lm $(GLEW_LIB)
	endif
endif

all: $(BIN_PATH)

$(BIN_PATH): $(OBJ) | $(BUILD_DIR)
	$(CC) $(OBJ) $(CFLAGS) -o $@ $(LIBS)

$(BUILD_DIR)/%.o: %.c | $(BUILD_DIR)
	$(CC) $(CPPFLAGS) $(CFLAGS) -c $< -o $@

$(BUILD_DIR):
	@mkdir -p $@

clean:
	rm -rf $(BUILD_DIR)

.PHONY: all clean

-include $(DEP)
