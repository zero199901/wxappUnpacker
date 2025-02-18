#!/bin/bash
# 添加错误处理
set -e

# 检查参数
if [ $# -lt 1 ]; then
    echo "使用方法: sh bingo.sh <wxapkg文件> [-d]"
    exit 1
fi

# 获取wxapkg文件名（不含扩展名）
WXAPKG_NAME=$(basename "$1" .wxapkg)

# 清理目标目录
if [ -d "${WXAPKG_NAME}" ]; then
    echo "清理已存在的目录: ${WXAPKG_NAME}"
    rm -rf "${WXAPKG_NAME}"
fi

# MyWxappUnpacker 项目路径
WXAPPUNPACKER_PATH=`pwd`

FILE_FORMAT=wxapkg

wxappUnpacker_pkg() {
  echo "node ${WXAPPUNPACKER_PATH}/wuWxapkg.js ${fname}"
  node ${WXAPPUNPACKER_PATH}/wuWxapkg.js $2 $1
  return 0;
}

wxappUnpacker() {
  de_dir=$1
    if [ -z "$1" ]
      then
        de_dir=`pwd`
      fi
  echo "${de_dir}"
  echo "for wxapkg in `find ${de_dir} -name "*.${FILE_FORMAT}"`"
  for fname in `find ${de_dir} -name "*.${FILE_FORMAT}"`
    do
      wxappUnpacker_pkg ${fname} $2
    done
  return 0;
}

de_pkg() {
  if [ "-d" == "$1" ]
    then
      wxappUnpacker $1 $2
    else
      wxappUnpacker_pkg $1 $2
    fi
  return 0;
}
# $1: pkg file or pkg dir; $2: order
de_pkg $1 $2

# 运行反编译
node wuWxapkg.js "$@" || {
    echo "反编译失败，请检查错误信息"
    exit 1
}


